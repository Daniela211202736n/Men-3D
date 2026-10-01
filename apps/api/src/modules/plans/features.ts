/**
 * Funciones habilitadas de cada restaurante, con cache corto.
 *
 * Vive aparte de `plugins/auth.ts` por una razon concreta: lo necesitan tanto
 * la autenticacion —para decidir si una ruta esta incluida en el plan— como la
 * facturacion, que al cobrar o suspender tiene que invalidar el cache. Si
 * estuviera en `auth`, los dos modulos se importarian en circulo y funcionaria
 * solo por como se izan las declaraciones de funcion: anda hasta que alguien
 * convierte una en `const`, y entonces falla en produccion.
 */
import { Feature, PLAN_FEATURES, type PlanTier } from '@men3d/shared';

import { parseEnumList } from '../../lib/lists.js';
import { prisma } from '../../prisma.js';
import { featuresVigentes, graciaVencida } from '../billing/service.js';

/** Cache corto de features por tenant: el plan cambia muy de vez en cuando. */
const featureCache = new Map<string, { features: Feature[]; expiresAt: number }>();
const FEATURE_TTL_MS = 60_000;

export async function getTenantFeatures(tenantId: string): Promise<Feature[]> {
  const cached = featureCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.features;

  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  let features: Feature[] = [];
  if (subscription) {
    // La lista explicita del plan manda; si viene vacia se cae a la tabla de
    // features por tier, para que un plan recien creado no quede sin nada.
    const explicit = parseEnumList(
      subscription.plan.features,
      Object.values(Feature),
    );
    const delPlan = explicit.length
      ? explicit
      : [...(PLAN_FEATURES[subscription.plan.tier as PlanTier] ?? [])];

    // Impago o baja: quedan las del plan gratuito, que incluye el visor 3D. La
    // carta del comensal sigue en pie; se apaga lo que usa el restaurante. El
    // porque esta en modules/billing/service.ts.
    //
    // La gracia se evalua aca y no solo en la tarea programada: si el dueño
    // entra el dia 8, tiene que ver la verdad aunque la tarea no haya corrido.
    const vencida = graciaVencida(
      subscription.status,
      subscription.graceEndsAt,
    );
    features = featuresVigentes(
      vencida ? 'SUSPENDED' : subscription.status,
      delPlan,
    );
  }

  featureCache.set(tenantId, {
    features,
    expiresAt: Date.now() + FEATURE_TTL_MS,
  });
  return features;
}

/** Se llama al cambiar de plan para que el cambio se vea de inmediato. */
export function invalidateTenantFeatures(tenantId: string): void {
  featureCache.delete(tenantId);
}
