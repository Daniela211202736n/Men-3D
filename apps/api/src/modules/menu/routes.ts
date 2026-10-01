/**
 * Superficie publica: todo lo que consume el comensal desde el celular.
 * Ninguna de estas rutas pide autenticacion; el tenant sale del slug de la URL.
 */
import {
  analyticsBatchSchema,
  AnalyticsEvent,
  isLocale,
  loyaltyLookupSchema,
  menuQuerySchema,
  orderCreateSchema,
  reviewCreateSchema,
  type Allergen,
  type DietTag,
  type Locale,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '../../env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toReviewDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import { tenantOf } from '../../plugins/tenant.js';
import { getPairings } from '../ai/recommender.js';
import { ingestEvents } from '../analytics/service.js';
import { getAccountDto } from '../loyalty/service.js';
import { createOrder, getOrderByCode } from '../orders/service.js';
import { registerScan } from '../qr/service.js';
import { getDishDetail, getMenu } from './service.js';

/** Un parametro de query puede venir repetido o separado por comas. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => asList(v));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export default async function publicRoutes(app: FastifyInstance): Promise<void> {
  // Cada ruta de este grupo resuelve primero el restaurante del slug.
  app.addHook('preHandler', app.resolveTenant);

  /** Datos del local sin la carta: lo primero que pinta la PWA. */
  app.get('/venue', async (request) => {
    const tenant = tenantOf(request);
    const menu = await getMenu(tenant, {});
    return menu.venue;
  });

  /** Carta completa con busqueda y filtros. */
  app.get('/menu', async (request) => {
    const tenant = tenantOf(request);
    const raw = request.query as Record<string, unknown>;

    const query = menuQuerySchema.parse({
      q: typeof raw.q === 'string' ? raw.q : undefined,
      categoryId: typeof raw.categoryId === 'string' ? raw.categoryId : undefined,
      diets: asList(raw.diets) as DietTag[],
      excludeAllergens: asList(raw.excludeAllergens) as Allergen[],
      only3d: raw.only3d === 'true' || raw.only3d === '1' ? true : undefined,
      locale: typeof raw.locale === 'string' && isLocale(raw.locale) ? raw.locale : undefined,
    });

    const menu = await getMenu(tenant, query);

    // Una busqueda sin resultados es informacion valiosa para el dueño: queda
    // registrada con la cantidad de coincidencias en `value`.
    if (query.q && typeof raw.sessionId === 'string') {
      await ingestEvents(tenant.id, [
        {
          type: AnalyticsEvent.SEARCH,
          sessionId: raw.sessionId,
          query: query.q,
          value: menu.matchCount,
          locale: menu.locale,
        },
      ]).catch(() => undefined);
    }

    const { matchCount, ...dto } = menu;
    return { ...dto, matchCount };
  });

  app.get('/dishes/:dishId', async (request) => {
    const tenant = tenantOf(request);
    const { dishId } = request.params as { dishId: string };
    const raw = request.query as { locale?: string };
    const dish = await getDishDetail(tenant, dishId, raw.locale);
    if (!dish) throw notFound('Plato');
    return dish;
  });

  /** Maridajes sugeridos para un plato. */
  app.get('/dishes/:dishId/pairings', async (request) => {
    const tenant = tenantOf(request);
    const { dishId } = request.params as { dishId: string };
    const raw = request.query as { locale?: string; limit?: string };
    const features = request.tenantFeatures ?? [];

    const locale: Locale =
      raw.locale && isLocale(raw.locale) ? raw.locale : (tenant.defaultLocale as Locale);

    return getPairings(tenant, dishId, {
      locale,
      limit: raw.limit ? Number(raw.limit) : 3,
      // El copy generado por IA solo si el plan lo incluye.
      withAiCopy: features.includes('AI_PAIRINGS'),
    });
  });

  /** Reseñas: de un plato (`?dishId=`) o generales del local. */
  app.get('/reviews', async (request) => {
    const tenant = tenantOf(request);
    const raw = request.query as { dishId?: string; limit?: string };
    const reviews = await prisma.review.findMany({
      where: {
        tenantId: tenant.id,
        status: 'PUBLISHED',
        dishId: raw.dishId ?? null,
      },
      include: { dish: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(raw.limit ?? 20), 100),
    });
    return reviews.map(toReviewDto);
  });

  app.post('/reviews', async (request, reply) => {
    const tenant = tenantOf(request);
    const input = reviewCreateSchema.parse(request.body);

    if (input.dishId) {
      const dish = await prisma.dish.findFirst({
        where: { id: input.dishId, tenantId: tenant.id },
        select: { id: true },
      });
      if (!dish) throw notFound('Plato');
    }

    const review = await prisma.review.create({
      data: {
        tenantId: tenant.id,
        dishId: input.dishId ?? null,
        rating: input.rating,
        comment: input.comment ?? null,
        authorName: input.authorName?.trim() || 'Anonimo',
      },
      include: { dish: { select: { id: true, name: true } } },
    });

    return reply.status(201).send(toReviewDto(review));
  });

  /** Ingesta de analitica. La PWA manda los eventos en lote. */
  app.post('/events', async (request, reply) => {
    const tenant = tenantOf(request);
    const { events } = analyticsBatchSchema.parse(request.body);
    const count = await ingestEvents(tenant.id, events);
    // 202: se acepto el lote; el cliente no espera nada a cambio.
    return reply.status(202).send({ accepted: count });
  });

  /** Registra el escaneo de un QR de mesa. */
  app.post('/scan', async (request, reply) => {
    const { token } = request.body as { token?: string };
    if (token) await registerScan(token);
    return reply.status(204).send();
  });

  /** Saldo de puntos del comensal. */
  app.get('/loyalty', async (request) => {
    const tenant = tenantOf(request);
    const { guestId } = loyaltyLookupSchema.parse(request.query);
    return getAccountDto(tenant.id, guestId, tenant.currency);
  });

  /** Checkout: crea el pedido y lanza el cobro. */
  app.post('/orders', async (request, reply) => {
    const tenant = tenantOf(request);
    const features = request.tenantFeatures ?? [];
    if (!features.includes('ONLINE_ORDERING')) {
      throw badRequest(
        'Este restaurante no tiene habilitado el pedido online',
        'ORDERING_DISABLED',
      );
    }

    const input = orderCreateSchema.parse(request.body);
    const returnUrl = new URL(`/m/${tenant.slug}/pedido`, env.PUBLIC_WEB_URL).toString();
    const result = await createOrder(tenant, input, returnUrl);
    return reply.status(201).send(result);
  });

  /** Seguimiento del pedido por su codigo corto. */
  app.get('/orders/:code', async (request) => {
    const tenant = tenantOf(request);
    const { code } = request.params as { code: string };
    return getOrderByCode(tenant.id, tenant.currency, code);
  });
}
