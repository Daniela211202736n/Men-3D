/**
 * Bus de eventos del KDS.
 *
 * Lo que importa probar es el caso que hoy falla en silencio: **un pedido que
 * entra por una instancia de la API tiene que llegar a la pantalla de cocina
 * conectada a otra.** Sin eso la API responde bien, el pedido se guarda, y la
 * cocina simplemente nunca se entera —lo descubre cuando el mozo va a
 * preguntar.
 *
 * Se prueba contra un Redis real (`docker compose up -d redis`). Un doble no
 * probaria nada: lo que se verifica es justamente que dos procesos distintos
 * se vean entre si.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { OrderDto } from '@men3d/shared';

import { BusConRedis, BusEnMemoria, crearBusKds, type KdsBus, type KdsEvent } from '../src/modules/orders/kds.js';

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TENANT = `tenant-prueba-${Date.now()}`;

/** Un pedido de mentira: al bus solo le importa transportarlo. */
function pedido(code: string): OrderDto {
  return { id: `id-${code}`, code } as unknown as OrderDto;
}

/** Espera un evento, o se rinde: sin tope, un fallo cuelga la prueba. */
function esperarEvento(bus: KdsBus, tenantId: string, ms = 3000): Promise<KdsEvent> {
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(() => {
      baja();
      reject(new Error(`no llego ningun evento en ${ms} ms`));
    }, ms);
    const baja = bus.subscribe(tenantId, (evento) => {
      clearTimeout(reloj);
      baja();
      resolve(evento);
    });
  });
}

describe('bus en memoria', () => {
  it('entrega a quien esta suscrito', async () => {
    const bus = new BusEnMemoria();
    const llegada = esperarEvento(bus, TENANT);
    bus.publish(TENANT, { type: 'order.created', order: pedido('AAA1') });

    const evento = await llegada;
    assert.equal(evento.type, 'order.created');
    assert.equal(evento.order.code, 'AAA1');
    await bus.close();
  });

  it('no entrega lo de otro restaurante', async () => {
    const bus = new BusEnMemoria();
    let recibido = false;
    const baja = bus.subscribe(TENANT, () => {
      recibido = true;
    });

    bus.publish('otro-restaurante', { type: 'order.created', order: pedido('BBB2') });
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(recibido, false, 'el KDS de un local vio el pedido de otro');
    baja();
    await bus.close();
  });

  it('sin REDIS_URL, la fabrica devuelve el de memoria', () => {
    const bus = crearBusKds(undefined);
    assert.equal(bus.modo, 'memoria');
  });
});

describe('bus con Redis', () => {
  // Tope por prueba: sin esto, una suscripcion que nunca se establece deja la
  // prueba colgada en vez de fallar, y en integracion continua eso se come el
  // tiempo del trabajo entero en lugar de dar un error claro.
  const TOPE = { timeout: 10_000 };

  let instanciaA: KdsBus;
  let instanciaB: KdsBus;

  before(() => {
    // Dos buses separados: son las dos instancias de la API detras del
    // balanceador. El mozo pide contra una, la cocina mira la otra.
    instanciaA = new BusConRedis(REDIS);
    instanciaB = new BusConRedis(REDIS);
  });

  after(async () => {
    await Promise.all([instanciaA.close(), instanciaB.close()]);
  });

  it('un pedido que entra por una instancia llega a la cocina de la otra', TOPE, async () => {
    // Es el motivo entero de reemplazar el bus en memoria.
    const enLaCocina = esperarEvento(instanciaB, TENANT);
    // Un respiro: `subscribe` es asincrono por dentro aunque devuelva ya.
    await new Promise((r) => setTimeout(r, 200));

    instanciaA.publish(TENANT, { type: 'order.created', order: pedido('CCC3') });

    const evento = await enLaCocina;
    assert.equal(evento.type, 'order.created');
    assert.equal(evento.order.code, 'CCC3');
  });

  it('publicar despues de suscribir no rompe la conexion', TOPE, async () => {
    // El error clasico: una conexion suscrita entra en modo suscriptor y deja
    // de aceptar comandos. Con una sola conexion, este publish falla.
    const llegada = esperarEvento(instanciaA, TENANT);
    await new Promise((r) => setTimeout(r, 200));

    instanciaA.publish(TENANT, { type: 'order.updated', order: pedido('DDD4') });

    const evento = await llegada;
    assert.equal(evento.order.code, 'DDD4');
  });

  it('tampoco cruza restaurantes', TOPE, async () => {
    let recibido = false;
    const baja = instanciaB.subscribe(TENANT, () => {
      recibido = true;
    });
    await new Promise((r) => setTimeout(r, 200));

    instanciaA.publish(`${TENANT}-otro`, { type: 'order.created', order: pedido('EEE5') });
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(recibido, false, 'un canal se filtro en otro');
    baja();
  });

  it('con REDIS_URL, la fabrica devuelve el de Redis', TOPE, async () => {
    const bus = crearBusKds(REDIS);
    assert.equal(bus.modo, 'redis');
    await bus.close();
  });
});
