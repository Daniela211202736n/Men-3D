/**
 * Backoffice — analitica, QR imprimible, compartir carta y traduccion automatica.
 */
import {
  analyticsRangeSchema,
  isLocale,
  qrOptionsSchema,
  translateRequestSchema,
  type Locale,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '../../env.js';
import { badRequest } from '../../lib/errors.js';
import { parseList } from '../../lib/lists.js';
import { prisma } from '../../prisma.js';
import { aiEnabled, translateDishes } from '../ai/claude.js';
import { getDashboard } from '../analytics/service.js';
import { ensureQrCodes, renderQrPdf, renderQrPng } from '../qr/service.js';

export default async function adminInsightsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ----------------------------------------------------------- analiticas
  app.get(
    '/analytics',
    { preHandler: [app.requireFeature('ADVANCED_ANALYTICS')] },
    async (request) => {
      const { tenantId } = request.authUser!;
      const { days } = analyticsRangeSchema.parse(request.query);
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { currency: true },
      });
      return getDashboard(tenantId, tenant.currency, days);
    },
  );

  /** Escaneos por mesa: que mesas realmente usan el menu digital. */
  app.get('/analytics/qr', async (request) => {
    const { tenantId } = request.authUser!;
    return prisma.qrCode.findMany({
      where: { tenantId },
      orderBy: { scans: 'desc' },
      select: { tableLabel: true, token: true, scans: true, lastScanAt: true },
    });
  });

  // ------------------------------------------------------------------ QR
  app.get('/qr', async (request) => {
    const { tenantId } = request.authUser!;
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true },
    });
    const raw = request.query as { tables?: string };
    const tables = raw.tables ? parseList(raw.tables) : [];
    return ensureQrCodes(tenantId, tenant.slug, tables);
  });

  /**
   * Descarga del QR. `format=pdf` devuelve las tarjetas listas para imprimir;
   * `format=png` devuelve una sola imagen (para redes o la vidriera).
   */
  app.get('/qr/download', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const raw = request.query as { tables?: string; format?: string; perPage?: string };
    const options = qrOptionsSchema.parse({
      tables: raw.tables ? parseList(raw.tables) : undefined,
      format: raw.format ?? 'pdf',
      perPage: raw.perPage ?? 4,
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      include: { branding: true },
    });
    const targets = await ensureQrCodes(
      tenantId,
      tenant.slug,
      options.tables ?? [],
    );

    if (options.format === 'png') {
      const png = await renderQrPng(targets[0]!.url);
      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `attachment; filename="qr-${tenant.slug}.png"`)
        .send(png);
    }

    const pdf = await renderQrPdf({
      restaurantName: tenant.name,
      perPage: options.perPage,
      targets,
      accentColor: tenant.branding?.primaryColor ?? '#2a78d6',
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="qr-${tenant.slug}.pdf"`)
      .send(pdf);
  });

  /** Enlaces listos para compartir la carta por WhatsApp o mail. */
  app.get('/share', async (request) => {
    const { tenantId } = request.authUser!;
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true, name: true },
    });

    const menuUrl = new URL(`/m/${tenant.slug}`, env.PUBLIC_WEB_URL).toString();
    const message = `Mira la carta de ${tenant.name} en 3D antes de pedir: ${menuUrl}`;

    return {
      menuUrl,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
      email:
        `mailto:?subject=${encodeURIComponent(`Carta de ${tenant.name}`)}` +
        `&body=${encodeURIComponent(message)}`,
      // Para el boton nativo de compartir del celular (navigator.share).
      shareText: message,
    };
  });

  // --------------------------------------------------- traduccion automatica
  app.get('/translations/:locale', async (request) => {
    const { tenantId } = request.authUser!;
    const { locale } = request.params as { locale: string };
    if (!isLocale(locale)) throw badRequest('Idioma no soportado');

    return prisma.dishTranslation.findMany({
      where: { locale, dish: { tenantId } },
      include: { dish: { select: { id: true, name: true } } },
    });
  });

  /**
   * Traduce la carta al idioma pedido. Degrada con elegancia: si no hay clave de
   * IA configurada devuelve 503 con un mensaje claro en vez de fallar raro.
   */
  app.post(
    '/translations',
    { preHandler: [app.requireFeature('AUTO_TRANSLATION')] },
    async (request, reply) => {
      const { tenantId } = request.authUser!;
      const input = translateRequestSchema.parse(request.body);

      if (!aiEnabled) {
        return reply.status(503).send({
          error: {
            code: 'AI_NOT_CONFIGURED',
            message:
              'La traduccion automatica necesita ANTHROPIC_API_KEY. Mientras tanto ' +
              'podes cargar las traducciones a mano desde el editor de cada plato.',
          },
        });
      }

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultLocale: true },
      });
      const sourceLocale = tenant.defaultLocale as Locale;
      if (sourceLocale === input.targetLocale) {
        throw badRequest('El idioma destino es el mismo que el de origen');
      }

      const dishes = await prisma.dish.findMany({
        where: {
          tenantId,
          archivedAt: null,
          ...(input.dishIds?.length ? { id: { in: input.dishIds } } : {}),
          // Sin `overwrite` se saltean los platos ya traducidos: no se vuelve a
          // pagar por traducir lo mismo.
          ...(input.overwrite
            ? {}
            : { translations: { none: { locale: input.targetLocale } } }),
        },
        select: { id: true, name: true, description: true },
      });

      if (dishes.length === 0) {
        return { translated: 0, skipped: 0, message: 'No habia nada por traducir' };
      }

      // Se trocea el pedido para no mandar una carta entera en un solo request.
      const BATCH_SIZE = 20;
      let translated = 0;
      for (let i = 0; i < dishes.length; i += BATCH_SIZE) {
        const batch = dishes.slice(i, i + BATCH_SIZE);
        const result = await translateDishes(
          batch,
          sourceLocale,
          input.targetLocale,
        );
        if (!result) continue;

        for (const [dishId, text] of result) {
          await prisma.dishTranslation.upsert({
            where: { dishId_locale: { dishId, locale: input.targetLocale } },
            create: {
              dishId,
              locale: input.targetLocale,
              name: text.name,
              description: text.description || null,
              source: 'AUTO',
            },
            update: {
              name: text.name,
              description: text.description || null,
              source: 'AUTO',
            },
          });
          translated += 1;
        }
      }

      return {
        translated,
        skipped: dishes.length - translated,
        locale: input.targetLocale,
      };
    },
  );

  /** Correccion manual de una traduccion generada. */
  app.put('/translations/:dishId/:locale', async (request) => {
    const { tenantId } = request.authUser!;
    const { dishId, locale } = request.params as { dishId: string; locale: string };
    if (!isLocale(locale)) throw badRequest('Idioma no soportado');
    const body = request.body as { name: string; description?: string };

    const dish = await prisma.dish.findFirst({
      where: { id: dishId, tenantId },
      select: { id: true },
    });
    if (!dish) throw badRequest('Plato inexistente');

    return prisma.dishTranslation.upsert({
      where: { dishId_locale: { dishId, locale } },
      create: {
        dishId,
        locale,
        name: body.name,
        description: body.description ?? null,
        source: 'MANUAL',
      },
      // Al editar a mano queda marcada como MANUAL: la traduccion automatica no
      // la vuelve a pisar.
      update: {
        name: body.name,
        description: body.description ?? null,
        source: 'MANUAL',
      },
    });
  });
}
