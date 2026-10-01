/**
 * Ensamblado de la API.
 *
 * Mapa de rutas:
 *   GET  /health                        — sonda de vida
 *   /api/auth/*                         — alta y login del backoffice
 *   /api/public/:slug/*                 — todo lo que ve el comensal (sin auth)
 *   /api/admin/*                        — backoffice (requiere JWT del tenant)
 *   POST /api/payments/webhook/:provider — notificaciones de la pasarela
 *   POST /upload  ·  GET /media/:name   — modelos 3D e imagenes
 */
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import { corsOrigins, env, isProduction } from './env.js';
import { registerErrorHandler } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import tenantPlugin from './plugins/tenant.js';
import adminCatalogRoutes from './modules/admin/catalog.routes.js';
import adminInsightsRoutes from './modules/admin/insights.routes.js';
import adminOperationsRoutes from './modules/admin/operations.routes.js';
import adminSettingsRoutes from './modules/admin/settings.routes.js';
import assetRoutes from './modules/assets/routes.js';
import authRoutes from './modules/auth/routes.js';
import kdsStreamRoutes from './modules/orders/kds.routes.js';
import paymentWebhookRoutes from './modules/payments/routes.js';
import publicRoutes from './modules/menu/routes.js';
import { prisma } from './prisma.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProduction
      ? { level: 'info' }
      : { level: 'info', transport: undefined },
    // Confia en el X-Forwarded-For del proxy: sin esto el rate limit cuenta
    // todas las visitas como si vinieran de una sola IP.
    trustProxy: isProduction,
    bodyLimit: 2 * 1024 * 1024,
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // El stream del KDS es una conexion larga, no un pico de trafico.
    allowList: (request) => request.url.startsWith('/api/admin/kds/stream'),
  });

  await app.register(multipart);
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  app.get('/health', async () => {
    // Una sonda que no toca la base no sirve de nada: la API sin base no anda.
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      env: env.NODE_ENV,
      payments: env.PAYMENTS_PROVIDER,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // --- autenticacion -------------------------------------------------------
  await app.register(
    async (instance) => {
      // Limite estricto en login/registro: es la puerta que se ataca por fuerza bruta.
      await instance.register(rateLimit, { max: 20, timeWindow: '5 minutes' });
      await instance.register(authRoutes);
    },
    { prefix: '/api/auth' },
  );

  // --- carta publica -------------------------------------------------------
  await app.register(publicRoutes, { prefix: '/api/public/:slug' });

  // --- backoffice ----------------------------------------------------------
  await app.register(
    async (instance) => {
      // Un solo guardia para todo el grupo: ninguna ruta de admin queda expuesta
      // por olvidarse el preHandler.
      instance.addHook('preHandler', instance.requireAuth);
      await instance.register(adminCatalogRoutes);
      await instance.register(adminSettingsRoutes);
      await instance.register(adminOperationsRoutes);
      await instance.register(adminInsightsRoutes);
    },
    { prefix: '/api/admin' },
  );

  // --- webhooks de las pasarelas de pago ------------------------------------
  // Publico a proposito: lo autentica la firma de la notificacion, no un token.
  await app.register(paymentWebhookRoutes, { prefix: '/api/payments' });

  // --- stream del KDS ------------------------------------------------------
  // Fuera del grupo anterior: se autentica con su propio ticket de 60 s.
  await app.register(kdsStreamRoutes, { prefix: '/api/admin' });

  // --- assets --------------------------------------------------------------
  await app.register(assetRoutes);

  return app;
}
