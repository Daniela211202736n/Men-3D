/**
 * Programa de puntos.
 *
 * El saldo nunca se escribe "a mano": se asienta un movimiento en el libro
 * mayor y el saldo se actualiza en la misma transaccion. Cada movimiento puede
 * llevar `dedupeKey`, asi un cliente que recarga la pantalla diez veces no
 * acumula diez veces los puntos por ver un plato.
 */
import {
  LOYALTY_POINTS,
  type LoyaltyAccountDto,
  type LoyaltyReason,
} from '@men3d/shared';

import { badRequest } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';

export async function getOrCreateAccount(tenantId: string, guestId: string) {
  return prisma.loyaltyAccount.upsert({
    where: { tenantId_guestId: { tenantId, guestId } },
    create: { tenantId, guestId },
    update: {},
  });
}

export interface EarnInput {
  tenantId: string;
  guestId: string;
  points: number;
  reason: LoyaltyReason;
  orderId?: string;
  /** Clave de idempotencia; si ya existe el movimiento, no se duplica. */
  dedupeKey?: string;
}

/** Acredita puntos. Devuelve el saldo resultante. */
export async function earnPoints(input: EarnInput): Promise<number> {
  if (input.points <= 0) throw badRequest('Los puntos a acreditar deben ser positivos');
  const account = await getOrCreateAccount(input.tenantId, input.guestId);

  if (input.dedupeKey) {
    const existing = await prisma.loyaltyLedger.findUnique({
      where: {
        accountId_dedupeKey: {
          accountId: account.id,
          dedupeKey: input.dedupeKey,
        },
      },
    });
    if (existing) return account.balance;
  }

  const [, updated] = await prisma.$transaction([
    prisma.loyaltyLedger.create({
      data: {
        accountId: account.id,
        points: input.points,
        reason: input.reason,
        orderId: input.orderId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    }),
    prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        balance: { increment: input.points },
        lifetimePoints: { increment: input.points },
      },
    }),
  ]);
  return updated.balance;
}

/**
 * Convierte puntos en descuento. Devuelve los puntos efectivamente canjeados y
 * los centavos de descuento, acotados por el saldo y por el total del pedido.
 */
export function quoteRedemption(
  balance: number,
  requestedPoints: number,
  subtotalCents: number,
): { points: number; discountCents: number } {
  const usablePoints = Math.max(0, Math.min(requestedPoints, balance));
  const rate = LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT;
  // Solo se canjean multiplos exactos del ratio: nada de medio punto perdido.
  const maxByOrder = Math.floor(subtotalCents / 100) * rate;
  const points = Math.min(usablePoints - (usablePoints % rate), maxByOrder);
  return { points, discountCents: (points / rate) * 100 };
}

export async function redeemPoints(input: {
  tenantId: string;
  guestId: string;
  points: number;
  orderId: string;
}): Promise<void> {
  if (input.points <= 0) return;
  const account = await getOrCreateAccount(input.tenantId, input.guestId);
  if (account.balance < input.points) {
    throw badRequest('Saldo de puntos insuficiente');
  }
  await prisma.$transaction([
    prisma.loyaltyLedger.create({
      data: {
        accountId: account.id,
        points: -input.points,
        reason: 'REDEMPTION',
        orderId: input.orderId,
      },
    }),
    prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: input.points } },
    }),
  ]);
}

export async function getAccountDto(
  tenantId: string,
  guestId: string,
  currency: string,
): Promise<LoyaltyAccountDto> {
  const account = await getOrCreateAccount(tenantId, guestId);
  const ledger = await prisma.loyaltyLedger.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });

  return {
    guestId,
    balance: account.balance,
    lifetimePoints: account.lifetimePoints,
    redeemableCents:
      Math.floor(account.balance / LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT) * 100,
    currency,
    history: ledger.map((entry) => ({
      id: entry.id,
      points: entry.points,
      reason: entry.reason as LoyaltyReason,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}
