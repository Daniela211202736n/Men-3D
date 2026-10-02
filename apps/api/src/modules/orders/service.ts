/**
 * Pedidos: armado, cobro y ciclo de vida en cocina.
 */
import {
  computeOrderTotals,
  LOYALTY_POINTS,
  OrderStatus,
  type OrderCreateInput,
  type OrderDto,
  type PaymentStatus,
} from '@men3d/shared';

import type { Order, OrderItem, Payment } from '@prisma/client';

import { env } from '../../env.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { generateOrderCode } from '../../lib/ids.js';
import { toOrderDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import type { PublicTenant } from '../../plugins/tenant.js';
import { earnPoints, getOrCreateAccount, quoteRedemption, redeemPoints } from '../loyalty/service.js';
import { getPaymentProvider } from '../payments/provider.js';
import { kdsBus } from './kds.js';
import { enviarConfirmacion } from './confirmation-mail.js';

/**
 * Puntos que acredita un pedido. Lo usan el cobro inmediato y la liquidacion
 * por webhook: si cada camino tuviera su formula, un mismo pedido acreditaria
 * distinto segun como se haya pagado.
 */
export function computeEarnedPoints(totalCents: number): number {
  return Math.floor((totalCents / 100) * LOYALTY_POINTS.PER_CURRENCY_UNIT);
}

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

  const pointsEarned = computeEarnedPoints(totals.totalCents);

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
      locale: input.locale ?? null,
      notes: input.notes ?? null,
      guestId: input.guestId ?? null,
      pointsRedeemed: redeemed.points,
      pointsEarned: 0,
      items: { create: lines },
    },
    include: { items: true },
  });

  // 4. Cobro.
  // La vuelta de la pasarela lleva al comensal al seguimiento de *su* pedido,
  // por eso la URL se arma aca: el codigo recien existe despues de crearlo.
  const returnUrl = new URL(
    `/m/${tenant.slug}/pedido/${created.code}`,
    env.PUBLIC_WEB_URL,
  ).toString();

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
    order = await settlePaidOrder(tenant.id, created.id, {
      guestId: input.guestId,
      pointsRedeemed: redeemed.points,
      pointsEarned,
    });
  }

  const dto = toOrderDto(order, tenant.currency, {
    checkoutUrl: charge.checkoutUrl ?? null,
    clientSecret: charge.clientSecret ?? null,
  });

  // La cocina solo se entera de lo que esta pagado. Con una pasarela con
  // redireccion el pedido todavia no lo esta: lo anuncia el webhook.
  if (dto.status === OrderStatus.PAID) {
    kdsBus().publish(tenant.id, { type: 'order.created', order: dto });
    enviarConfirmacion({
      order,
      nombreDelLocal: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
    });
  }

  return {
    order: dto,
    checkoutUrl: charge.checkoutUrl ?? null,
    clientSecret: charge.clientSecret ?? null,
  };
}

/**
 * Marca el pedido como pagado y mueve los puntos. Idempotente.
 *
 * Toma el `tenantId` suelto y no el tenant entero porque lo llaman dos caminos
 * muy distintos: el cobro inmediato, que ya tiene el tenant cargado, y el
 * webhook, que solo conoce el pedido.
 */
export async function settlePaidOrder(
  tenantId: string,
  orderId: string,
  opts: { guestId?: string | null; pointsRedeemed: number; pointsEarned: number },
) {
  const current = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true, payment: true },
  });
  if (!current) throw notFound('Pedido');
  if (current.status === OrderStatus.PAID) return current;

  if (opts.guestId && opts.pointsRedeemed > 0) {
    await redeemPoints({
      tenantId,
      guestId: opts.guestId,
      points: opts.pointsRedeemed,
      orderId,
    });
  }
  if (opts.guestId && opts.pointsEarned > 0) {
    await earnPoints({
      tenantId,
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
  kdsBus().publish(tenantId, { type: 'order.updated', order: dto });
  return dto;
}

/**
 * Aplica a un pedido lo que informa la pasarela.
 *
 * Es el unico camino por el que un pedido pagado con redireccion llega a PAID,
 * y es idempotente a proposito: MercadoPago reintenta cada notificacion hasta
 * recibir un 2xx, asi que la misma puede llegar varias veces.
 *
 * Tres comprobaciones antes de dar nada por cobrado:
 *   1. el pedido existe;
 *   2. el importe informado coincide con el total del pedido;
 *   3. el estado que llega es realmente "cobrado".
 */
export async function applyPaymentUpdate(input: {
  orderId: string;
  providerRef: string;
  provider: string;
  status: PaymentStatus;
  amountCents: number | null;
  raw: unknown;
}): Promise<{ outcome: 'settled' | 'recorded' | 'ignored'; reason?: string }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    // El nombre y el slug son para el correo de confirmacion.
    include: {
      items: true,
      payment: true,
      tenant: { select: { currency: true, name: true, slug: true } },
    },
  });
  if (!order) return { outcome: 'ignored', reason: 'el pedido no existe' };

  // Un importe distinto del total significa que algo se manipulo en el medio:
  // se deja constancia y no se marca como pagado.
  const amountMismatch =
    input.amountCents !== null && input.amountCents !== order.totalCents;

  await prisma.payment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      provider: input.provider,
      providerRef: input.providerRef,
      status: amountMismatch ? 'FAILED' : input.status,
      amountCents: input.amountCents ?? order.totalCents,
      currency: order.tenant.currency,
      rawPayload: JSON.stringify(input.raw),
    },
    update: {
      providerRef: input.providerRef,
      status: amountMismatch ? 'FAILED' : input.status,
      ...(input.amountCents !== null ? { amountCents: input.amountCents } : {}),
      rawPayload: JSON.stringify(input.raw),
    },
  });

  if (amountMismatch) {
    return {
      outcome: 'recorded',
      reason: `el importe informado (${input.amountCents}) no coincide con el del pedido (${order.totalCents})`,
    };
  }

  if (input.status !== 'SUCCEEDED') {
    return { outcome: 'recorded', reason: `estado ${input.status}` };
  }

  if (order.status === OrderStatus.PAID || isAfterPaid(order.status)) {
    // Ya estaba cobrado: la notificacion es un reintento.
    return { outcome: 'ignored', reason: 'el pedido ya estaba pagado' };
  }

  const settled = await settlePaidOrder(order.tenantId, order.id, {
    guestId: order.guestId,
    pointsRedeemed: order.pointsRedeemed,
    pointsEarned: computeEarnedPoints(order.totalCents),
  });

  // Recien ahora la cocina se entera del pedido.
  kdsBus().publish(order.tenantId, {
    type: 'order.created',
    order: toOrderDto(settled, order.tenant.currency),
  });

  enviarConfirmacion({
    order: settled,
    nombreDelLocal: order.tenant.name,
    slug: order.tenant.slug,
    currency: order.tenant.currency,
  });

  return { outcome: 'settled' };
}

/** `true` si el pedido ya paso por PAID (esta en cocina, listo o servido). */
function isAfterPaid(status: string): boolean {
  return (
    status === OrderStatus.IN_KITCHEN ||
    status === OrderStatus.READY ||
    status === OrderStatus.SERVED
  );
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

/**
 * Un pedido por su codigo, para la pantalla de seguimiento.
 *
 * **El codigo corto no alcanza para dar datos personales.** Son cuatro
 * caracteres sobre un alfabeto de 32: poco mas de un millon de combinaciones,
 * y un restaurante con unos miles de pedidos hace que una de cada pocos
 * cientos acierte. Probando codigos al azar se leen los pedidos de otros.
 *
 * El codigo es corto a proposito —se canta en voz alta en el mostrador— asi
 * que la solucion no es alargarlo sino no devolver con el nada que señale a
 * una persona. Con el codigo solo salen el estado, los platos y el importe,
 * que es lo que hace falta para seguir el pedido y para que el mostrador lo
 * busque. El nombre y las aclaraciones salen unicamente si quien pregunta
 * demuestra ser el mismo dispositivo que lo hizo.
 */
export async function getOrderByCode(
  tenantId: string,
  currency: string,
  code: string,
  guestId?: string,
): Promise<OrderDto> {
  const order = await prisma.order.findUnique({
    where: { tenantId_code: { tenantId, code: code.toUpperCase() } },
    include: { items: true, payment: true },
  });
  if (!order) throw notFound('Pedido');

  const esSuyo = Boolean(guestId && order.guestId && order.guestId === guestId);
  const dto = toOrderDto(order, currency);
  if (esSuyo) return dto;

  return { ...dto, customerName: null, notes: null };
}
