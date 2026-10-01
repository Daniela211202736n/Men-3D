/**
 * Backoffice — datos del local, branding y plan.
 */
import {
  brandingSchema,
  PLAN_FEATURES,
  venueSettingsSchema,
  type PlanTier,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { serializeList } from '../../lib/lists.js';
import { toBrandingDto, toVenueDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import { getTenantFeatures, invalidateTenantFeatures } from '../../plugins/auth.js';
import { loadVenueRating } from '../menu/service.js';

export default async function adminSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/venue', async (request) => {
    const { tenantId } = request.authUser!;
    const [tenant, rating, features] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        include: { branding: true },
      }),
      loadVenueRating(tenantId),
      getTenantFeatures(tenantId),
    ]);
    return toVenueDto(tenant, rating, features);
  });

  app.patch('/venue', async (request) => {
    const { tenantId } = request.authUser!;
    const input = venueSettingsSchema.parse(request.body);
    const { enabledLocales, serviceModes, ...scalars } = input;

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...scalars,
        // Las listas se guardan como texto separado por comas (ver lib/lists.ts).
        ...(enabledLocales ? { enabledLocales: serializeList(enabledLocales) } : {}),
        ...(serviceModes ? { serviceModes: serializeList(serviceModes) } : {}),
      },
      include: { branding: true },
    });

    const [rating, features] = await Promise.all([
      loadVenueRating(tenantId),
      getTenantFeatures(tenantId),
    ]);
    return toVenueDto(tenant, rating, features);
  });

  app.get('/branding', async (request) => {
    const { tenantId } = request.authUser!;
    const branding = await prisma.branding.findUnique({ where: { tenantId } });
    return toBrandingDto(branding);
  });

  app.patch(
    '/branding',
    { preHandler: [app.requireFeature('CUSTOM_BRANDING')] },
    async (request) => {
      const { tenantId } = request.authUser!;
      const input = brandingSchema.parse(request.body);
      const branding = await prisma.branding.upsert({
        where: { tenantId },
        create: { tenantId, ...input },
        update: input,
      });
      return toBrandingDto(branding);
    },
  );

  /** Plan vigente, limites y uso actual: lo que muestra la pantalla de cuenta. */
  app.get('/plan', async (request) => {
    const { tenantId } = request.authUser!;
    const [subscription, features, dishCount, modelCount] = await Promise.all([
      prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
      getTenantFeatures(tenantId),
      prisma.dish.count({ where: { tenantId, archivedAt: null } }),
      prisma.dish.count({
        where: { tenantId, archivedAt: null, modelGlbUrl: { not: null } },
      }),
    ]);

    const tier = (subscription?.plan.tier as PlanTier) ?? 'FREE';
    return {
      tier,
      status: subscription?.status ?? 'CANCELED',
      trialEndsAt: subscription?.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      monthlyCents: subscription?.plan.monthlyCents ?? 0,
      setupFeeCents: subscription?.plan.setupFeeCents ?? 0,
      setupFeePaid: subscription?.setupFeePaid ?? false,
      features: features.length ? features : [...(PLAN_FEATURES[tier] ?? [])],
      usage: {
        dishes: dishCount,
        maxDishes: subscription?.plan.maxDishes ?? 0,
        models3d: modelCount,
        max3dModels: subscription?.plan.max3dModels ?? 0,
      },
    };
  });

  /** Cambio de plan. En produccion lo dispara el webhook de la facturacion. */
  app.put(
    '/plan',
    { preHandler: [app.requireRole('OWNER')] },
    async (request) => {
      const { tenantId } = request.authUser!;
      const { tier } = request.body as { tier: PlanTier };
      const plan = await prisma.plan.findUniqueOrThrow({ where: { tier } });

      await prisma.subscription.upsert({
        where: { tenantId },
        create: { tenantId, planId: plan.id, status: 'ACTIVE' },
        update: { planId: plan.id, status: 'ACTIVE' },
      });
      // Sin esto el cache de features seguiria sirviendo el plan anterior.
      invalidateTenantFeatures(tenantId);
      return { tier: plan.tier, features: await getTenantFeatures(tenantId) };
    },
  );

  app.get('/plans', async () =>
    prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { monthlyCents: 'asc' },
    }),
  );
}
