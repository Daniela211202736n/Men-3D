/**
 * Bus que empuja los cambios de pedido al KDS por SSE.
 *
 * Dos implementaciones detras de la misma interfaz:
 *
 *  - **En memoria** (por defecto): alcanza mientras la API corra en un solo
 *    proceso, que es el caso en desarrollo y en un despliegue chico.
 *  - **Redis** (`REDIS_URL`): necesaria apenas hay mas de una instancia. Sin
 *    ella el fallo no es visible: la API responde bien, el pedido se guarda, y
 *    la pantalla de cocina conectada a *otra* instancia simplemente nunca se
 *    entera. La cocina descubre el pedido cuando el mozo va a preguntar.
 *
 * `publish` es sincrona a proposito. Lo que la llama es el flujo del pedido
 * —crear, cobrar, cambiar de estado— y ese flujo no puede quedar esperando al
 * bus ni fallar porque el bus falle: el pedido ya esta guardado y esa es la
 * verdad. Si Redis no responde, se pierde el aviso y se registra; el KDS
 * recupera el estado al reconectar, que es justamente lo que hace al abrirse.
 */
import { EventEmitter } from 'node:events';

import type { OrderDto } from '@men3d/shared';
import { Redis } from 'ioredis';

import { env } from '../../env.js';

export type KdsEvent =
  | { type: 'order.created'; order: OrderDto }
  | { type: 'order.updated'; order: OrderDto };

export interface KdsBus {
  publish(tenantId: string, event: KdsEvent): void;
  /** Devuelve la funcion para darse de baja. */
  subscribe(tenantId: string, listener: (event: KdsEvent) => void): () => void;
  /** Cierra las conexiones. Solo hace algo en la implementacion con Redis. */
  close(): Promise<void>;
  readonly modo: 'memoria' | 'redis';
}

/* ------------------------------------------------------------- en memoria */

class BusEnMemoria implements KdsBus {
  readonly modo = 'memoria' as const;
  private readonly emitter = new EventEmitter();

  constructor() {
    // Un restaurante con muchas pantallas de cocina abiertas no deberia
    // disparar la advertencia de "possible memory leak" de Node.
    this.emitter.setMaxListeners(100);
  }

  publish(tenantId: string, event: KdsEvent): void {
    this.emitter.emit(tenantId, event);
  }

  subscribe(tenantId: string, listener: (event: KdsEvent) => void): () => void {
    this.emitter.on(tenantId, listener);
    return () => this.emitter.off(tenantId, listener);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}

/* ------------------------------------------------------------------ redis */

/** Un canal por restaurante: una instancia solo recibe lo que le toca. */
function canal(tenantId: string): string {
  return `men3d:kds:${tenantId}`;
}

class BusConRedis implements KdsBus {
  readonly modo = 'redis' as const;

  /**
   * Dos conexiones, no una.
   *
   * Una conexion suscrita a Redis entra en modo suscriptor y deja de aceptar
   * otros comandos: con una sola, el primer `publish` despues de un `subscribe`
   * falla. Es el error clasico de la primera implementacion.
   */
  private readonly publicador: Redis;
  private readonly suscriptor: Redis;

  /** Oyentes locales por restaurante, para repartir lo que llega de Redis. */
  private readonly locales = new Map<string, Set<(event: KdsEvent) => void>>();

  constructor(url: string) {
    // Que la API no se caiga ni se cuelgue si Redis no esta: el bus es un extra
    // sobre el pedido, que ya quedo guardado en PostgreSQL. Tras estos
    // reintentos el comando falla, se registra y la vida sigue.
    const comun = { maxRetriesPerRequest: 2, lazyConnect: false };

    this.publicador = new Redis(url, comun);
    this.suscriptor = new Redis(url, {
      ...comun,
      // La cola de espera queda activa en el suscriptor a proposito: el primer
      // `subscribe` sale apenas se abre la primera pantalla de cocina, que
      // puede ser antes de que el socket este listo. Con la cola desactivada
      // ese comando se descarta —"Stream isn't writeable"— y la pantalla queda
      // muda para siempre sin que nada falle a la vista.
      enableOfflineQueue: true,
    });

    for (const conexion of [this.publicador, this.suscriptor]) {
      // Sin un manejador de `error`, un Redis caido tumba el proceso entero.
      conexion.on('error', (error) => {
        console.error('[kds] error de Redis:', error.message);
      });

      // El bus no puede ser lo que mantiene vivo al proceso. La API sigue
      // levantada porque escucha en un puerto, no por tener un cliente de
      // Redis abierto; y cualquier script o prueba que publique un evento
      // tiene que poder terminar. En cada reconexion hay un socket nuevo, asi
      // que se hace en `connect` y no una sola vez.
      conexion.on('connect', () => {
        conexion.stream?.unref?.();
      });
    }

    this.suscriptor.on('message', (channel: string, payload: string) => {
      const tenantId = channel.slice('men3d:kds:'.length);
      const oyentes = this.locales.get(tenantId);
      if (!oyentes?.size) return;
      let evento: KdsEvent;
      try {
        evento = JSON.parse(payload) as KdsEvent;
      } catch {
        console.error('[kds] llego un evento ilegible por Redis');
        return;
      }
      for (const oyente of oyentes) oyente(evento);
    });
  }

  publish(tenantId: string, event: KdsEvent): void {
    // Sin await: ver la cabecera. El fallo se registra y no se propaga.
    void this.publicador
      .publish(canal(tenantId), JSON.stringify(event))
      .catch((error: unknown) => {
        console.error(
          '[kds] no se pudo publicar el evento:',
          error instanceof Error ? error.message : error,
        );
      });
  }

  subscribe(tenantId: string, listener: (event: KdsEvent) => void): () => void {
    let oyentes = this.locales.get(tenantId);
    if (!oyentes) {
      oyentes = new Set();
      this.locales.set(tenantId, oyentes);
      // Primer oyente de este restaurante en esta instancia: recien ahi hace
      // falta el canal.
      void this.suscriptor.subscribe(canal(tenantId)).catch((error: unknown) => {
        console.error(
          '[kds] no se pudo suscribir:',
          error instanceof Error ? error.message : error,
        );
      });
    }
    oyentes.add(listener);

    return () => {
      const actuales = this.locales.get(tenantId);
      if (!actuales) return;
      actuales.delete(listener);
      if (actuales.size === 0) {
        this.locales.delete(tenantId);
        // Se cerro la ultima pantalla: no tiene sentido seguir recibiendo.
        void this.suscriptor.unsubscribe(canal(tenantId)).catch(() => {});
      }
    };
  }

  async close(): Promise<void> {
    this.locales.clear();
    await Promise.all([cerrar(this.publicador), cerrar(this.suscriptor)]);
  }
}

/**
 * Cierra una conexion sin quedarse esperando.
 *
 * `quit()` es el cierre ordenado —avisa al servidor— pero espera respuesta, y
 * contra un Redis que no contesta no resuelve nunca. Apagar la API no puede
 * depender de que Redis este vivo, asi que despues de un momento se corta por
 * lo sano. Sin esto, el proceso queda colgado al terminar.
 */
async function cerrar(conexion: Redis): Promise<void> {
  const PACIENCIA_MS = 1000;
  await Promise.race([
    conexion.quit().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, PACIENCIA_MS)),
  ]);
  // Idempotente: si `quit` ya cerro, esto no hace nada.
  conexion.disconnect(false);
}

/* ----------------------------------------------------------------- fabrica */

/**
 * Construye un bus. Sin `url`, el de memoria.
 *
 * La URL se pasa siempre explicita en lugar de tomarla por defecto del
 * entorno: con un valor por defecto, `crearBusKds(undefined)` —que se lee como
 * "sin Redis"— devolvia el de Redis igual, y eso es exactamente lo que uno
 * escribe cuando quiere el de memoria.
 */
export function crearBusKds(url?: string): KdsBus {
  return url ? new BusConRedis(url) : new BusEnMemoria();
}

let instancia: KdsBus | null = null;

/**
 * El bus de la aplicacion, creado la primera vez que se lo usa.
 *
 * Perezoso y no una constante del modulo porque la version con Redis abre
 * sockets al construirse: como constante, cualquier archivo que importara este
 * modulo —aunque fuera por una cadena de imports y nunca tocara el KDS— abria
 * dos conexiones y dejaba el proceso vivo para siempre. Se nota enseguida en
 * las pruebas, que dejan de terminar.
 */
export function kdsBus(): KdsBus {
  instancia ??= crearBusKds(env.REDIS_URL);
  return instancia;
}

/** Cierra el bus si llego a crearse. Lo llama el `onClose` de la aplicacion. */
export async function cerrarBusKds(): Promise<void> {
  if (!instancia) return;
  await instancia.close();
  instancia = null;
}

export { BusConRedis, BusEnMemoria };
