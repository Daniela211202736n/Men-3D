/**
 * El catalogo de planes.
 *
 * Esto NO son datos de demostracion: son los datos de referencia que la
 * plataforma necesita para funcionar. Sin ellos, quien se registra se queda sin
 * suscripcion, `featuresVigentes` no encuentra plan y la carta le sale con los
 * pedidos deshabilitados. Vivian dentro del sembrado de demo, que en produccion
 * nadie corre —y no deberia, crea dos restaurantes de juguete— asi que una base
 * recien migrada quedaba sin planes.
 *
 * Por eso viven aca, en `src`, y no en el sembrado: asi se compilan dentro de
 * la imagen y un despliegue los puede aplicar sin tsx ni codigo de desarrollo.
 * Se aplican solos, despues de las migraciones:
 *
 *   npm run db:plans           # desarrollo y integracion continua (tsx)
 *   npm run db:plans:prod      # dentro de la imagen (node dist/...)
 *
 * Es idempotente: volver a correrlo actualiza precios, topes y features de los
 * planes que ya existen, sin tocar las suscripciones.
 */
import { PLAN_FEATURES } from '@men3d/shared';
import type { PrismaClient } from '@prisma/client';

/** Precios en centavos: 2900000 = $29.000. */
export const PLANES = [
  {
    tier: 'FREE',
    name: 'Prueba',
    monthlyCents: 0,
    setupFeeCents: 0,
    maxDishes: 15,
    max3dModels: 3,
  },
  {
    tier: 'STARTER',
    name: 'Starter',
    monthlyCents: 2900000,
    setupFeeCents: 9900000,
    maxDishes: 60,
    max3dModels: 15,
  },
  {
    tier: 'PRO',
    name: 'Pro',
    monthlyCents: 5900000,
    setupFeeCents: 19900000,
    maxDishes: 0,
    max3dModels: 60,
  },
  {
    tier: 'ENTERPRISE',
    name: 'Enterprise',
    monthlyCents: 14900000,
    setupFeeCents: 49900000,
    maxDishes: 0,
    max3dModels: 0,
  },
] as const;

/** Deja el catalogo de planes como dice PLANES. Devuelve cuantos aplico. */
export async function sembrarPlanes(prisma: PrismaClient): Promise<number> {
  for (const plan of PLANES) {
    const features = [...(PLAN_FEATURES[plan.tier] ?? [])].join(',');
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      create: { ...plan, features },
      update: { ...plan, features },
    });
  }
  return PLANES.length;
}
