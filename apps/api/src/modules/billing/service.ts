/**
 * Estado de la suscripcion al SaaS: que pasa cuando el restaurante no paga.
 *
 * La decision de producto que ordena todo el modulo:
 *
 * **Si no paga, el restaurante vuelve al plan gratuito. No se le apaga la
 * carta.**
 *
 * Es tentador cortar el acceso entero —es la palanca mas fuerte— pero el QR
 * esta pegado en las mesas. Un comensal que lo escanea un viernes a las nueve
 * de la noche y se encuentra con una pagina muerta no castiga al restaurante
 * por no pagarnos: concluye que el producto no anda, delante de sus invitados,
 * y el restaurante lo desengancha de la mesa el lunes. Perderiamos al cliente y
 * la recomendacion.
 *
 * Volver al plan gratuito mantiene la carta y el visor 3D en pie —que es lo que
 * ve el comensal— y apaga lo que usa el restaurante: pedidos, pagos, analitica,
 * traduccion, marca propia. Lo siente quien decide pagar, no quien esta
 * cenando. Y nada de lo cargado se borra: al cobrar, vuelve todo tal cual.
 *
 * El camino completo de un cobro fallido:
 *
 *   ACTIVE ──falla el cobro──▶ PAST_DUE ──vence la gracia──▶ SUSPENDED
 *      ▲                           │                            │
 *      └───────────── cobra ───────┴────────────────────────────┘
 *
 * PAST_DUE no cambia nada para nadie: son los dias de gracia, y existen porque
 * la causa mas comun de un cobro fallido es una tarjeta vencida, no una
 * decision de irse.
 */
import { PLAN_FEATURES, type Feature, type PlanTier } from '@men3d/shared';

import { prisma } from '../../prisma.js';
import { invalidateTenantFeatures } from '../plans/features.js';

/**
 * Dias que sigue andando todo despues de un cobro fallido.
 *
 * Siete cubre el caso real —una tarjeta vencida, el dueño que lo ve el lunes—
 * sin regalar un mes.
 */
export const DIAS_DE_GRACIA = 7;

/** Estados en los que el restaurante tiene el plan que contrato. */
const AL_DIA = new Set(['TRIALING', 'ACTIVE', 'PAST_DUE']);

export type EstadoSuscripcion =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELED';

/**
 * Funciones que le corresponden al restaurante ahora mismo.
 *
 * Suspendido o cancelado: las del plan gratuito, que incluye el visor 3D. El
 * comensal no se entera de nada.
 */
export function featuresVigentes(
  status: string,
  featuresDelPlan: Feature[],
): Feature[] {
  if (AL_DIA.has(status)) return featuresDelPlan;
  return [...PLAN_FEATURES.FREE];
}

/** Si el periodo de gracia ya vencio. */
export function graciaVencida(
  status: string,
  graceEndsAt: Date | null,
  ahora = new Date(),
): boolean {
  return status === 'PAST_DUE' && graceEndsAt !== null && graceEndsAt <= ahora;
}

/**
 * Pasa a SUSPENDED la suscripcion de UN restaurante si su gracia vencio.
 *
 * Existe aparte del barrido para que leer el estado no toque a nadie mas: que
 * el dueño de un local abra su pantalla de plan no es razon para escribir en
 * las suscripciones de los demas.
 */
export async function suspenderSiVencio(
  tenantId: string,
  ahora = new Date(),
): Promise<boolean> {
  const { count } = await prisma.subscription.updateMany({
    where: { tenantId, status: 'PAST_DUE', graceEndsAt: { lte: ahora } },
    data: { status: 'SUSPENDED' },
  });
  if (count > 0) invalidateTenantFeatures(tenantId);
  return count > 0;
}

/**
 * Pasa a SUSPENDED todas las suscripciones cuya gracia vencio.
 *
 * Esto es el barrido de la tarea programada. El estado igual se evalua al leer
 * —ver `graciaVencida`— para que un dueño que entra el dia 8 vea la verdad
 * aunque la tarea no haya corrido.
 */
export async function suspenderVencidas(ahora = new Date()): Promise<number> {
  const vencidas = await prisma.subscription.findMany({
    where: { status: 'PAST_DUE', graceEndsAt: { lte: ahora } },
    select: { id: true, tenantId: true },
  });
  if (vencidas.length === 0) return 0;

  await prisma.subscription.updateMany({
    where: { id: { in: vencidas.map((v) => v.id) } },
    data: { status: 'SUSPENDED' },
  });
  // Sin esto el cache seguiria dando las funciones del plan pago.
  for (const v of vencidas) invalidateTenantFeatures(v.tenantId);
  return vencidas.length;
}

/** Un cobro que entro: la suscripcion queda al dia y el periodo se corre. */
export async function registrarCobro(
  subscriptionId: string,
  finDelPeriodo: Date,
): Promise<void> {
  const sub = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE',
      currentPeriodEnd: finDelPeriodo,
      // Se limpia: si vuelve a fallar, la gracia arranca de cero.
      graceEndsAt: null,
      lastPaymentAt: new Date(),
    },
  });
  invalidateTenantFeatures(sub.tenantId);
}

/**
 * Un cobro que no entro.
 *
 * La gracia se fija una sola vez: si ya estaba en PAST_DUE, un segundo intento
 * fallido no se la renueva. Si no, reintentar seria extender el plazo para
 * siempre.
 */
export async function registrarCobroFallido(
  subscriptionId: string,
  ahora = new Date(),
): Promise<void> {
  const actual = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { status: true, graceEndsAt: true, tenantId: true },
  });
  if (actual.status === 'PAST_DUE' && actual.graceEndsAt) return;

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'PAST_DUE',
      graceEndsAt: new Date(ahora.getTime() + DIAS_DE_GRACIA * 24 * 60 * 60_000),
    },
  });
  invalidateTenantFeatures(actual.tenantId);
}

/** Baja de la suscripcion. Lo cargado no se toca. */
export async function cancelar(subscriptionId: string): Promise<void> {
  const sub = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: 'CANCELED', canceledAt: new Date(), graceEndsAt: null },
  });
  invalidateTenantFeatures(sub.tenantId);
}

/**
 * Guarda el aviso de la pasarela y dice si es nuevo.
 *
 * MercadoPago reintenta los avisos y no garantiza orden ni unicidad. Sin esto,
 * el reintento de un aviso de cobro correria el periodo dos veces y el
 * restaurante tendria un mes de regalo.
 */
export async function registrarAviso(input: {
  provider: string;
  eventId: string;
  type: string;
  status?: string;
  payload: unknown;
  subscriptionId?: string;
}): Promise<{ esNuevo: boolean }> {
  try {
    await prisma.billingEvent.create({
      data: {
        provider: input.provider,
        eventId: input.eventId,
        type: input.type,
        status: input.status ?? null,
        payload: JSON.stringify(input.payload),
        subscriptionId: input.subscriptionId ?? null,
      },
    });
    return { esNuevo: true };
  } catch (error) {
    // P2002 = ya estaba. Es el caso normal de un reintento, no un fallo.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { esNuevo: false };
    }
    throw error;
  }
}
