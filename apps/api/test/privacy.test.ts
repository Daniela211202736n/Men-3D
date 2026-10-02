/**
 * Datos del comensal: exportacion y borrado.
 *
 * Lo que mas importa comprobar es que el borrado haga exactamente lo que la
 * pantalla promete, ni mas ni menos:
 *
 *  - Las opiniones y los puntos se van.
 *  - Los pedidos **no** se borran: se anonimizan. Un pedido es un comprobante
 *    de venta que el restaurante esta obligado a conservar; si el comensal
 *    pudiera hacerlo desaparecer, le romperiamos los libros a nuestro cliente.
 *  - Despues de borrar no tiene que quedar ningun hilo del que tirar: ni el
 *    nombre, ni el telefono, ni el mail, ni el `guestId`. Si quedara el
 *    `guestId`, el pedido seguiria atado al dispositivo y el borrado seria de
 *    mentira.
 *  - Y el importe tiene que seguir ahi: eso es lo que el restaurante necesita.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const SUFFIX = Date.now();
const SLUG = `privacidad-${SUFFIX}`;
const GUEST = 'g-' + 'a1b2c3d4e5f6a7b8c9d0e1f2'.slice(0, 24);
const OTRO_GUEST = 'g-' + '0f1e2d3c4b5a09876543210f'.slice(0, 24);

let app: FastifyInstance;
let tenantId: string;
let dishId: string;

async function crearPedido(guestId: string, code: string) {
  return prisma.order.create({
    data: {
      tenantId,
      code,
      status: 'PAID',
      guestId,
      customerName: 'Comensal de prueba',
      customerPhone: '+54 11 5555-5555',
      customerEmail: 'comensal@prueba.demo',
      notes: 'Sin sal, por favor',
      subtotalCents: 100_000,
      totalCents: 121_000,
      taxCents: 21_000,
    },
  });
}

before(async () => {
  app = await buildApp();
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Privacidad', defaultLocale: 'es' },
  });
  tenantId = tenant.id;
  const categoria = await prisma.category.create({
    data: { tenantId, name: 'Unica', position: 0 },
  });
  const plato = await prisma.dish.create({
    data: { tenantId, categoryId: categoria.id, name: 'Plato', priceCents: 100_000 },
  });
  dishId = plato.id;

  await crearPedido(GUEST, `PRI1${SUFFIX}`.slice(0, 12));
  await crearPedido(OTRO_GUEST, `PRI2${SUFFIX}`.slice(0, 12));

  await prisma.review.create({
    data: { tenantId, dishId, rating: 5, comment: 'Muy bueno', authorName: 'Yo', guestId: GUEST },
  });
  await prisma.review.create({
    data: { tenantId, dishId, rating: 4, comment: 'De otro', authorName: 'Otro', guestId: OTRO_GUEST },
  });
  await prisma.loyaltyAccount.create({
    data: { tenantId, guestId: GUEST, balance: 120, lifetimePoints: 300 },
  });
});

after(async () => {
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

const url = (metodo: 'GET' | 'DELETE', guestId: string) => ({
  method: metodo,
  url: `/api/public/${SLUG}/privacy/data`,
  query: { guestId },
});

describe('ver los propios datos', () => {
  it('devuelve pedidos, opiniones y puntos', async () => {
    const response = await app.inject(url('GET', GUEST));
    assert.equal(response.statusCode, 200, response.body);

    const body = response.json();
    assert.equal(body.pedidos.length, 1);
    assert.equal(body.opiniones.length, 1);
    assert.equal(body.puntos.saldo, 120);
  });

  it('no devuelve los datos de otro dispositivo', async () => {
    const body = (await app.inject(url('GET', GUEST))).json();
    const comentarios = body.opiniones.map((o: { comment: string }) => o.comment);
    assert.ok(!comentarios.includes('De otro'), 'se filtro la opinion de otro comensal');
  });

  it('dice por que la analitica no figura', async () => {
    // Si algun dia se vincula la analitica al dispositivo, esta prueba tiene
    // que fallar: pasaria a ser dato personal y habria que exportarla.
    const body = (await app.inject(url('GET', GUEST))).json();
    assert.match(body.analitica, /no esta vinculado a tu dispositivo/i);
  });

  it('un identificador con otra forma se rechaza', async () => {
    const response = await app.inject(url('GET', 'cualquier-cosa'));
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'GUEST_ID_INVALIDO');
  });
});

describe('borrar los propios datos', () => {
  it('el pedido queda sin ningun dato personal, pero con el importe', async () => {
    const response = await app.inject(url('DELETE', GUEST));
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().pedidosAnonimizados, 1);

    const pedido = await prisma.order.findFirstOrThrow({
      where: { tenantId, code: `PRI1${SUFFIX}`.slice(0, 12) },
    });

    // Ningun hilo del que tirar.
    assert.equal(pedido.customerName, null);
    assert.equal(pedido.customerPhone, null);
    assert.equal(pedido.customerEmail, null);
    assert.equal(pedido.notes, null);
    assert.equal(pedido.guestId, null, 'quedo atado al dispositivo: el borrado seria de mentira');

    // Y el comprobante sigue siendo un comprobante.
    assert.equal(pedido.totalCents, 121_000);
    assert.equal(pedido.status, 'PAID');
  });

  it('las opiniones y los puntos se van de verdad', async () => {
    const opiniones = await prisma.review.count({ where: { tenantId, guestId: GUEST } });
    const cuenta = await prisma.loyaltyAccount.findUnique({
      where: { tenantId_guestId: { tenantId, guestId: GUEST } },
    });
    assert.equal(opiniones, 0);
    assert.equal(cuenta, null);
  });

  it('no toca los datos de otro dispositivo', async () => {
    // El borrado de uno no puede arrastrar al de al lado.
    const otro = await prisma.order.findFirstOrThrow({
      where: { tenantId, code: `PRI2${SUFFIX}`.slice(0, 12) },
    });
    assert.equal(otro.customerName, 'Comensal de prueba');
    assert.equal(otro.guestId, OTRO_GUEST);

    const suOpinion = await prisma.review.count({ where: { tenantId, guestId: OTRO_GUEST } });
    assert.equal(suOpinion, 1);
  });

  it('borrar dos veces no falla', async () => {
    // El comensal puede tocar el boton de nuevo sin que explote nada.
    const response = await app.inject(url('DELETE', GUEST));
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pedidosAnonimizados, 0);
  });
});
