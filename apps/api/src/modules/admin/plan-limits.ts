/**
 * Limites del plan aplicados al escribir.
 *
 * Mostrarlos en la pantalla de "Plan y uso" no alcanza: si no se bloquea la
 * escritura, un restaurante del plan Starter carga sesenta platos y el limite
 * es decorativo. Se comprueba justo antes de crear, que es el unico momento en
 * que la cuenta puede cruzar el tope.
 *
 * `0` significa sin limite.
 */
import { PLAN_FEATURES, type PlanTier } from '@men3d/shared';

import { AppError } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';

/** El plan vigente del restaurante, con sus topes. */
async function planDe(tenantId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  return subscription?.plan ?? null;
}

/** Primer plan que levanta el tope, para poder sugerirlo en el mensaje. */
function planQueLoPermite(
  actual: PlanTier,
  campo: 'maxDishes' | 'max3dModels',
  planes: Array<{ tier: string; maxDishes: number; max3dModels: number }>,
  necesarios: number,
): string | null {
  const orden: PlanTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
  const desde = orden.indexOf(actual) + 1;
  for (const tier of orden.slice(desde)) {
    const plan = planes.find((p) => p.tier === tier);
    if (!plan) continue;
    const tope = plan[campo];
    if (tope === 0 || tope >= necesarios) return tier;
  }
  return null;
}

function excederia(tope: number, usoActual: number): boolean {
  return tope > 0 && usoActual >= tope;
}

/**
 * Falla si crear un plato mas cruzaria el tope del plan.
 *
 * Se llama antes de crear, no despues: un 403 con el motivo es mejor que crear
 * y revertir.
 */
export async function verificarLimiteDePlatos(tenantId: string): Promise<void> {
  const plan = await planDe(tenantId);
  if (!plan || plan.maxDishes === 0) return;

  const actuales = await prisma.dish.count({
    where: { tenantId, archivedAt: null },
  });
  if (!excederia(plan.maxDishes, actuales)) return;

  const planes = await prisma.plan.findMany({
    select: { tier: true, maxDishes: true, max3dModels: true },
  });
  const sugerido = planQueLoPermite(
    plan.tier as PlanTier,
    'maxDishes',
    planes,
    actuales + 1,
  );

  throw new AppError(
    403,
    'PLAN_LIMIT_DISHES',
    `Tu plan ${plan.tier} permite ${plan.maxDishes} platos y ya tenes ${actuales}. ` +
      (sugerido
        ? `El plan ${sugerido} levanta ese limite.`
        : 'Dá de baja alguno para cargar uno nuevo.'),
  );
}

/**
 * Falla si asignar un modelo 3D mas cruzaria el tope del plan.
 *
 * `dishId` permite distinguir "este plato ya tenia modelo" (cambiarlo no suma)
 * de "le estamos poniendo el primero" (suma uno).
 */
export async function verificarLimiteDeModelos(
  tenantId: string,
  dishId?: string,
): Promise<void> {
  const plan = await planDe(tenantId);
  if (!plan || plan.max3dModels === 0) return;

  if (dishId) {
    const actual = await prisma.dish.findFirst({
      where: { id: dishId, tenantId },
      select: { modelGlbUrl: true },
    });
    // Reemplazar un modelo existente no cambia la cuenta.
    if (actual?.modelGlbUrl) return;
  }

  const actuales = await prisma.dish.count({
    where: { tenantId, archivedAt: null, modelGlbUrl: { not: null } },
  });
  if (!excederia(plan.max3dModels, actuales)) return;

  const planes = await prisma.plan.findMany({
    select: { tier: true, maxDishes: true, max3dModels: true },
  });
  const sugerido = planQueLoPermite(
    plan.tier as PlanTier,
    'max3dModels',
    planes,
    actuales + 1,
  );

  throw new AppError(
    403,
    'PLAN_LIMIT_MODELS',
    `Tu plan ${plan.tier} incluye ${plan.max3dModels} modelos 3D y ya tenes ${actuales}. ` +
      (sugerido
        ? `El plan ${sugerido} levanta ese limite.`
        : 'Quitale el modelo a otro plato para liberar uno.'),
  );
}

export { PLAN_FEATURES };
