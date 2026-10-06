/**
 * Adaptador de Meshy (https://docs.meshy.ai).
 *
 * El trato con su API es simple y asincronico:
 *
 *   POST /openapi/v1/image-to-3d        -> 202 { result: "<id>" }
 *   GET  /openapi/v1/image-to-3d/<id>   -> { status, progress, model_urls, ... }
 *
 * Tres cosas de esta API condicionan el diseño y conviene tenerlas a la vista:
 *
 *  1. **`image_url` acepta un data URI.** Es lo que permite que esto funcione
 *     con `STORAGE_DRIVER=local`, donde la foto recien subida no es alcanzable
 *     desde internet. Se manda la foto en el cuerpo y listo.
 *  2. **El resultado caduca.** Meshy conserva los archivos generados tres dias
 *     en los planes que no son Enterprise. Enlazar su URL desde la carta seria
 *     una carta que se rompe sola el jueves: el GLB se baja y se guarda en
 *     nuestro almacenamiento apenas termina.
 *  3. **Cada trabajo cuesta creditos.** Por eso la fila en la base y el indice
 *     unico parcial se crean *antes* de llamar aca.
 *
 * Nada de esto es exclusivo de Meshy; si se cambia de proveedor, las tres
 * siguen siendo las preguntas que hay que hacerle al nuevo.
 */
import { env } from '../../env.js';
import type { EstadoRemoto, FotoDelPlato, ProveedorDe3D } from './proveedor.js';

const BASE = 'https://api.meshy.ai';

/** Un trabajo tarda minutos, pero cada peticion suelta tiene que ser corta. */
const TIMEOUT_MS = 30_000;
/** Bajar el GLB si puede tardar: son varios MB. */
const TIMEOUT_DESCARGA_MS = 120_000;

interface TareaMeshy {
  id?: string;
  status?: string;
  progress?: number;
  model_urls?: Record<string, string>;
  consumed_credits?: number;
  task_error?: { message?: string };
}

export class MeshyProvider implements ProveedorDe3D {
  readonly nombre = 'meshy';

  constructor(
    private readonly apiKey: string,
    private readonly aiModel: string = env.MESHY_AI_MODEL,
  ) {}

  private async pedir<T>(
    ruta: string,
    init: RequestInit = {},
    timeout = TIMEOUT_MS,
  ): Promise<T> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${BASE}${ruta}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (causa) {
      // Un timeout o un DNS caido no son "la foto estaba mal": el mensaje tiene
      // que dejar claro que el problema es del otro lado.
      throw new Error(
        `No se pudo hablar con el generador de modelos 3D: ${
          causa instanceof Error ? causa.message : String(causa)
        }`,
      );
    }

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.text().catch(() => '')).slice(0, 300);
      throw new Error(
        `El generador de modelos 3D respondio ${respuesta.status}${
          cuerpo ? `: ${cuerpo}` : ''
        }`,
      );
    }
    return (await respuesta.json()) as T;
  }

  async crear(fotos: FotoDelPlato[]): Promise<string> {
    const foto = fotos[0];
    if (!foto) throw new Error('No se recibio ninguna foto');

    const dataUri = `data:${foto.contentType};base64,${foto.bytes.toString('base64')}`;

    const { result } = await this.pedir<{ result?: string }>(
      '/openapi/v1/image-to-3d',
      {
        method: 'POST',
        body: JSON.stringify({
          image_url: dataUri,
          ai_model: this.aiModel,
          enable_pbr: true,
          // 1024 y no 2048: la textura es casi todo el peso del GLB, y el plato
          // se mira en un celular dentro de un cuadro de pocos centimetros.
          // Pedirla chica en el origen evita tener que recomprimirla despues.
          texture_resolution: '1024',
          target_formats: ['glb'],
        }),
      },
    );

    if (!result) {
      throw new Error('El generador de modelos 3D no devolvio un identificador');
    }
    return result;
  }

  async consultar(taskId: string): Promise<EstadoRemoto> {
    const tarea = await this.pedir<TareaMeshy>(
      `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
    );
    const progreso = Math.max(0, Math.min(100, Math.round(tarea.progress ?? 0)));

    switch (tarea.status) {
      case 'SUCCEEDED': {
        const glbUrl = tarea.model_urls?.glb;
        if (!glbUrl) {
          return {
            estado: 'FAILED',
            progreso,
            error: 'El modelo quedo listo pero el proveedor no devolvio el GLB',
          };
        }
        return {
          estado: 'READY',
          progreso: 100,
          glbUrl,
          creditos: tarea.consumed_credits,
        };
      }
      case 'FAILED':
      case 'CANCELED':
      case 'EXPIRED':
        return {
          estado: 'FAILED',
          progreso,
          error:
            tarea.task_error?.message ??
            `El generador de modelos 3D termino en ${tarea.status}`,
          creditos: tarea.consumed_credits,
        };
      default:
        // PENDING, IN_PROGRESS, y cualquier estado nuevo que agreguen: se trata
        // como "sigue trabajando". Es lo unico seguro con un estado que no
        // conocemos; el trabajo tiene su propio vencimiento del lado nuestro.
        return { estado: 'RUNNING', progreso };
    }
  }

  async bajar(url: string): Promise<Buffer> {
    // La URL la dio el proveedor en su propia respuesta, no un cliente: no hay
    // que tratarla como entrada del usuario, pero si acotar el tiempo.
    const respuesta = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_DESCARGA_MS),
    });
    if (!respuesta.ok) {
      throw new Error(`No se pudo bajar el modelo generado (${respuesta.status})`);
    }
    return Buffer.from(await respuesta.arrayBuffer());
  }

  async comprobar(): Promise<{ ok: boolean; detalle: string }> {
    try {
      // El nombre del campo del saldo no esta garantizado entre versiones: si
      // no se reconoce, un 200 ya prueba que la clave sirve, que es lo que se
      // estaba comprobando.
      const saldo = await this.pedir<Record<string, unknown>>('/openapi/v1/balance');
      const creditos = [saldo.balance, saldo.credits, saldo.remaining_credits].find(
        (v) => typeof v === 'number',
      );
      if (typeof creditos !== 'number') {
        return { ok: true, detalle: 'La clave funciona (el saldo no vino en la respuesta)' };
      }
      // Un modelo cuesta del orden de 20-30 creditos: con menos que eso, la
      // proxima foto que saque un restaurante va a fallar.
      if (creditos < 30) {
        return {
          ok: false,
          detalle: `La clave funciona pero quedan ${creditos} creditos: no alcanzan para un modelo`,
        };
      }
      return { ok: true, detalle: `${creditos} creditos disponibles` };
    } catch (causa) {
      return {
        ok: false,
        detalle: causa instanceof Error ? causa.message : String(causa),
      };
    }
  }
}
