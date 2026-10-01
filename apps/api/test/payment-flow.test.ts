/**
 * Prueba de integracion del camino del dinero: que hace el sistema cuando una
 * pasarela con redireccion avisa que un pedido se pago.
 *
 * Toca la base de verdad. Crea su propio restaurante con un slug unico y lo
 * borra al terminar (el borrado en cascada se lleva pedidos, pagos y puntos),
 * asi no ensucia los datos de demostracion ni depende de ellos.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { OrderStatus } from '@men3d/shared';

import { prisma } from '../src/prisma.js';
import { applyPaymentUpdate, computeEarnedPoints } from '../src/modules/orders/service.js';

const SLUG = `test-pagos-${Date.now()}`;
const GUEST = 'guest-de-prueba-0001';

let tenantId: string;
let dishId: string;

/** Crea un pedido pendiente de pago, como lo dejaria Checkout Pro. */
async function crearPedidoPendiente(totalCents: number, code: string) {
  return prisma.order.create({
    data: {
      tenantId,
      code,
      status: OrderStatus.PENDING_PAYMENT,
      serviceMode: 'DINE_IN',
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      guestId: GUEST,
      items: {
        create: [
          {
            dishId,
            nameSnapshot: 'Plato de prueba',
            unitPriceCents: totalCents,
            quantity: 1,
          },
        ],
      },
      payment: {
        create: {
          provider: 'mercadopago',
          providerRef: 'pref-123',
          status: 'PROCESSING',
          amountCents: totalCents,
          currency: 'ARS',
        },
      },
    },
  });
}

before(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: SLUG,
      name: 'Restaurante de prueba',
      currency: 'ARS',
      categories: { create: { name: 'Pruebas', position: 0 } },
    },
    include: { categories: true },
  });
  tenantId = tenant.id;

  const dish = await prisma.dish.create({
    data: {
      tenantId,
      categoryId: tenant.categories[0]!.id,
      name: 'Plato de prueba',
      priceCents: 100_000,
    },
  });
  dishId = dish.id;
});

after(async () => {
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

describe('notificacion de pago aprobado', () => {
  it('deja el pedido pagado y acredita los puntos', async () => {
    const order = await crearPedidoPendiente(250_000, 'TST1');

    const result = await applyPaymentUpdate({
      orderId: order.id,
      providerRef: 'pago-aprobado-1',
      provider: 'mercadopago',
      status: 'SUCCEEDED',
      amountCents: 250_000,
      raw: { status: 'approved' },
    });

    assert.equal(result.outcome, 'settled');

    const actualizado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    assert.equal(actualizado.status, OrderStatus.PAID);
    assert.equal(actualizado.payment?.status, 'SUCCEEDED');
    // El id del cobro reemplaza al de la preferencia que se guardo al crearlo.
    assert.equal(actualizado.payment?.providerRef, 'pago-aprobado-1');
    assert.equal(actualizado.pointsEarned, computeEarnedPoints(250_000));

    const cuenta = await prisma.loyaltyAccount.findUnique({
      where: { tenantId_guestId: { tenantId, guestId: GUEST } },
    });
    assert.equal(cuenta?.balance, computeEarnedPoints(250_000));
  });

  it('no acredita dos veces si la notificacion se repite', async () => {
    const order = await crearPedidoPendiente(100_000, 'TST2');
    const notificacion = {
      orderId: order.id,
      providerRef: 'pago-aprobado-2',
      provider: 'mercadopago',
      status: 'SUCCEEDED' as const,
      amountCents: 100_000,
      raw: {},
    };

    const primera = await applyPaymentUpdate(notificacion);
    const saldoTrasPrimera = (
      await prisma.loyaltyAccount.findUniqueOrThrow({
        where: { tenantId_guestId: { tenantId, guestId: GUEST } },
      })
    ).balance;

    // MercadoPago reintenta hasta recibir un 2xx: la misma puede llegar varias veces.
    const segunda = await applyPaymentUpdate(notificacion);
    const tercera = await applyPaymentUpdate(notificacion);

    assert.equal(primera.outcome, 'settled');
    assert.equal(segunda.outcome, 'ignored');
    assert.equal(tercera.outcome, 'ignored');

    const saldoFinal = (
      await prisma.loyaltyAccount.findUniqueOrThrow({
        where: { tenantId_guestId: { tenantId, guestId: GUEST } },
      })
    ).balance;
    assert.equal(saldoFinal, saldoTrasPrimera);
  });
});

describe('notificaciones que no deben pagar el pedido', () => {
  it('rechaza un importe que no coincide con el total', async () => {
    const order = await crearPedidoPendiente(500_000, 'TST3');

    const result = await applyPaymentUpdate({
      orderId: order.id,
      providerRef: 'pago-manipulado',
      provider: 'mercadopago',
      status: 'SUCCEEDED',
      // Alguien intenta pagar un peso por un pedido de 5.000.
      amountCents: 100,
      raw: {},
    });

    assert.equal(result.outcome, 'recorded');
    assert.match(result.reason ?? '', /importe/);

    const actualizado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    assert.equal(actualizado.status, OrderStatus.PENDING_PAYMENT);
    assert.equal(actualizado.payment?.status, 'FAILED');
  });

  it('un pago pendiente deja el pedido esperando', async () => {
    const order = await crearPedidoPendiente(80_000, 'TST4');

    const result = await applyPaymentUpdate({
      orderId: order.id,
      providerRef: 'pago-pendiente',
      provider: 'mercadopago',
      status: 'PROCESSING',
      amountCents: 80_000,
      raw: { status: 'pending' },
    });

    assert.equal(result.outcome, 'recorded');
    const actualizado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    assert.equal(actualizado.status, OrderStatus.PENDING_PAYMENT);
    assert.equal(actualizado.payment?.status, 'PROCESSING');
  });

  it('un rechazo no mueve el pedido', async () => {
    const order = await crearPedidoPendiente(60_000, 'TST5');

    await applyPaymentUpdate({
      orderId: order.id,
      providerRef: 'pago-rechazado',
      provider: 'mercadopago',
      status: 'FAILED',
      amountCents: 60_000,
      raw: { status: 'rejected' },
    });

    const actualizado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    assert.equal(actualizado.status, OrderStatus.PENDING_PAYMENT);
    assert.equal(actualizado.payment?.status, 'FAILED');
  });

  it('ignora una notificacion de un pedido inexistente', async () => {
    const result = await applyPaymentUpdate({
      orderId: 'pedido-que-no-existe',
      providerRef: 'x',
      provider: 'mercadopago',
      status: 'SUCCEEDED',
      amountCents: 1000,
      raw: {},
    });
    assert.equal(result.outcome, 'ignored');
  });

  it('acepta que no informen importe y confia en el total del pedido', async () => {
    const order = await crearPedidoPendiente(40_000, 'TST6');

    const result = await applyPaymentUpdate({
      orderId: order.id,
      providerRef: 'pago-sin-importe',
      provider: 'mercadopago',
      status: 'SUCCEEDED',
      amountCents: null,
      raw: {},
    });

    assert.equal(result.outcome, 'settled');
    const actualizado = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    assert.equal(actualizado.status, OrderStatus.PAID);
  });
});
