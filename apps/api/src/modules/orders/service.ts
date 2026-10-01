/**
 * Pedidos: armado, cobro y ciclo de vida en cocina.
 */
import {
  computeOrderTotals,
  LOYALTY_POINTS,
  OrderStatus,
  type OrderCreateInput,
  type OrderDto,
} from '@men3d/shared';

import type { Order, OrderItem, Payment } from '@prisma/client';

import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateOrderCode } from '../../lib/ids.js';
import { toOrderDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import type { PublicTenant } from '../../plugins/tenant.js';
import { earnPoints, getOrCreateAccount, quoteRedemption, redeemPoints } from '../loyalty/service.js';
import { getPaymentProvider } from '../payments/provider.js';
import { kdsHub } from './kds.js';

/** Transiciones validas: evita que una pantalla desincronizada retroceda un pedido. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_PAYMENT', 'PAID', 'CANCELED'],
  PENDING_PAYMENT: ['PAID', 'CANCELED'],
  PAID: ['IN_KITCHEN', 'CANCELED'],
  IN_KITCHEN: ['READY', 'CANCELED'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Genera un codigo libre para el tenant; reintenta ante colision. */
async function allocateOrderCode(tenantId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateOrderCode(attempt < 5 ? 4 : 5);
    const existing = await prisma.order.findUnique({
      where: { tenantId_code: { tenantId, code } },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw conflict('No se pudo generar un codigo de pedido libre, reintenta');
}

export interface CreateOrderResult {
  order: OrderDto;
  checkoutUrl: string | null;
  clientSecret: string | null;
}

export async function createOrder(
  tenant: PublicTenant,
  input: OrderCreateInput,
  returnUrl: string,
): Promise<CreateOrderResult> {
  // 1. Los platos tienen que ser de este tenant, estar activos y disponibles.
  const dishIds = [...new Set(input.items.map((i) => i.dishId))];
  const dishes = await prisma.dish.findMany({
    where: {
      id: { in: dishIds },
      tenantId: tenant.id,
      archivedAt: null,
      isAvailable: true,
    },
    select: { id: true, name: true, priceCents: true },
  });
  const dishById = new Map(dishes.map((d) => [d.id, d]));

  const missing = dishIds.filter((id) => !dishById.has(id));
  if (missing.length > 0) {
    throw badRequest(
      'Algunos platos del carrito ya no estan disponibles. Revisa el pedido.',
      'DISH_UNAVAILABLE',
    );
  }

  // 2. El precio se toma de la base, nunca del cliente.
  const lines = input.items.map((item) => {
    const dish = dishById.get(item.dishId)!;
    return {
      dishId: dish.id,
      nameSnapshot: dish.name,
      unitPriceCents: dish.priceCents,
      quantity: item.quantity,
      notes: item.notes ?? null,
    };
  });

  // 3. Canje de puntos (si pidio y tiene saldo).
  const subtotalCents = lines.reduce(
    (acc, l) => acc + l.unitPriceCents * l.quantity,
    0,
  );
  let redeemed = { points: 0, discountCents: 0 };
  if (input.redeemPoints && input.redeemPoints > 0 && input.guestId) {
    const account = await getOrCreateAccount(tenant.id, input.guestId);
    redeemed = quoteRedemption(
      account.balance,
      input.redeemPoints,
      subtotalCents,
    );
  }

  const totals = computeOrderTotals(lines, {
    taxRateBps: tenant.taxRateBps,
    discountCents: redeemed.discountCents,
  });

  const pointsEarned = Math.floor(
    (totals.totalCents / 100) * LOYALTY_POINTS.PER_CURRENCY_UNIT,
  );

  const code = await allocateOrderCode(tenant.id);

  const created = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      code,
      status: OrderStatus.PENDING_PAYMENT,
      serviceMode: input.serviceMode,
      tableLabel: input.tableLabel ?? null,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      notes: input.notes ?? null,
      guestId: input.guestId ?? null,
      pointsRedeemed: redeemed.points,
      pointsEarned: 0,
      items: { create: lines },
    },
    include: { items: true },
  });

  // 4. Cobro.
  const provider = getPaymentProvider();
  const charge = await provider.createCharge({
    orderId: created.id,
    orderCode: created.code,
    amountCents: created.totalCents,
    currency: tenant.currency,
    description: `${tenant.name} — pedido ${created.code}`,
    customerEmail: input.customerEmail ?? null,
    returnUrl,
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: created.id,
      provider: charge.provider,
      providerRef: charge.providerRef,
      status: charge.status,
      amountCents: created.totalCents,
      currency: tenant.currency,
      rawPayload: charge.raw ? JSON.stringify(charge.raw) : null,
    },
  });

  // 5. Si el cobro ya quedo aprobado, el pedido entra a cocina y se acreditan
  //    los puntos. Con pasarelas con redireccion esto ocurre en el webhook.
  let order: Order & { items: OrderItem[]; payment: Payment | null } = {
    ...created,
    payment,
  };
  if (charge.status === 'SUCCEEDED') {
    order = await settlePaidOrder(tenant, created.id, {
      guestId: input.guestId,
      pointsRedeemed: redeemed.points,
      pointsEarned,
    });
  }

  const dto = toOrderDto(order, tenant.currency, {
    checkoutUrl: charge.checkoutUrl ?? null,
    clientSecret: charge.clientSecret ?? null,
  });
  kdsHub.publish(tenant.id, { type: 'order.created', order: dto });

  return {
    order: dto,
    checkoutUrl: charge.checkoutUrl ?? null,
    clientSecret: charge.clientSecret ?? null,
  };
}

/** Marca el pedido como pagado y mueve los puntos. Idempotente. */
export async function settlePaidOrder(
  tenant: PublicTenant,
  orderId: string,
  opts: { guestId?: string | null; pointsRedeemed: number; pointsEarned: number },
) {
  const current = await prisma.order.findFirst({
    where: { id: orderId, tenantId: tenant.id },
    include: { items: true, payment: true },
  });
  if (!current) throw notFound('Pedido');
  if (current.status === OrderStatus.PAID) return current;

  if (opts.guestId && opts.pointsRedeemed > 0) {
    await redeemPoints({
      tenantId: tenant.id,
      guestId: opts.guestId,
      points: opts.pointsRedeemed,
      orderId,
    });
  }
  if (opts.guestId && opts.pointsEarned > 0) {
    await earnPoints({
      tenantId: tenant.id,
      guestId: opts.guestId,
      points: opts.pointsEarned,
      reason: 'ORDER',
      orderId,
      // Un pedido acredita sus puntos una sola vez, aunque el webhook repita.
      dedupeKey: `order:${orderId}`,
    });
  }

  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.PAID,
      pointsEarned: opts.pointsEarned,
    },
    include: { items: true, payment: true },
  });
}

export async function updateOrderStatus(
  tenantId: string,
  currency: string,
  orderId: string,
  nextStatus: string,
): Promise<OrderDto> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true, payment: true },
  });
  if (!order) throw notFound('Pedido');

  if (order.status === nextStatus) {
    return toOrderDto(order, currency);
  }
  if (!canTransition(order.status, nextStatus)) {
    throw conflict(
      `No se puede pasar un pedido de ${order.status} a ${nextStatus}`,
    );
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: nextStatus,
      ...(nextStatus === OrderStatus.IN_KITCHEN ? { acceptedAt: new Date() } : {}),
      ...(nextStatus === OrderStatus.READY ? { readyAt: new Date() } : {}),
    },
    include: { items: true, payment: true },
  });

  const dto = toOrderDto(updated, currency);
  kdsHub.publish(tenantId, { type: 'order.updated', order: dto });
  return dto;
}

export async function listOrders(
  tenantId: string,
  currency: string,
  opts: { statuses?: string[]; limit?: number; since?: Date } = {},
): Promise<OrderDto[]> {
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      ...(opts.statuses?.length ? { status: { in: opts.statuses } } : {}),
      ...(opts.since ? { createdAt: { gte: opts.since } } : {}),
    },
    include: { items: true, payment: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  });
  return orders.map((o) => toOrderDto(o, currency));
}

export async function getOrderByCode(
  tenantId: string,
  currency: string,
  code: string,
): Promise<OrderDto> {
  const order = await prisma.order.findUnique({
    where: { tenantId_code: { tenantId, code: code.toUpperCase() } },
    include: { items: true, payment: true },
  });
  if (!order) throw notFound('Pedido');
  return toOrderDto(order, currency);
}
