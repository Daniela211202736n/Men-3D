/**
 * Autenticacion del backoffice y autorizacion por rol / feature del plan.
 *
 * El token lleva `tenantId`: ninguna ruta de administracion acepta un tenant
 * por parametro, se toma siempre del token. Asi un admin no puede tocar la
 * carta de otro restaurante cambiando un id en la URL.
 */
import fastifyJwt from '@fastify/jwt';
import { Feature, PLAN_FEATURES, UserRole, type PlanTier } from '@men3d/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { parseEnumList } from '../lib/lists.js';
import { prisma } from '../prisma.js';

export interface AuthPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  email: string;
  /**
   * Alcance del token. Ausente = sesion normal del backoffice. `kds` marca un
   * ticket de un minuto, emitido solo para abrir el stream SSE de cocina (ver
   * modules/orders/kds.routes.ts).
   */
  scope?: 'kds';
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario autenticado; solo definido tras pasar por `requireAuth`. */
    authUser?: AuthPayload;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireFeature: (
      feature: Feature,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

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
  if (subscription && subscription.status !== 'CANCELED') {
    // La lista explicita del plan manda; si viene vacia se cae a la tabla de
    // features por tier, para que un plan recien creado no quede sin nada.
    const explicit = parseEnumList(
      subscription.plan.features,
      Object.values(Feature),
    );
    features = explicit.length
      ? explicit
      : [...(PLAN_FEATURES[subscription.plan.tier as PlanTier] ?? [])];
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

export default fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '12h' },
  });

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized('Sesion vencida o token invalido');
    }
    const payload = request.user;

    // Un token con alcance no es una sesion. El ticket del KDS viaja en una URL
    // —y una URL termina en logs de proxy, en el historial y en el `Referer`—
    // asi que si sirviera como sesion, filtrarlo daria acceso al backoffice
    // entero. Solo lo acepta la ruta del stream, que lo verifica aparte.
    if (payload.scope) {
      throw unauthorized(
        'Este token solo sirve para el stream de cocina, no para el backoffice',
      );
    }

    // El token podria ser valido pero el usuario haber sido dado de baja.
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
      select: { id: true, tenantId: true, role: true, email: true },
    });
    if (!user) throw unauthorized('El usuario ya no esta activo');

    request.authUser = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role as UserRole,
      email: user.email,
    };
  });

  app.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest) => {
        const user = request.authUser;
        if (!user) throw unauthorized();
        if (!roles.includes(user.role)) {
          throw forbidden(
            `Esta accion requiere uno de estos roles: ${roles.join(', ')}`,
          );
        }
      },
  );

  app.decorate(
    'requireFeature',
    (feature: Feature) => async (request: FastifyRequest) => {
      const user = request.authUser;
      if (!user) throw unauthorized();
      const features = await getTenantFeatures(user.tenantId);
      if (!features.includes(feature)) {
        throw forbidden(
          `La funcionalidad ${feature} no esta incluida en tu plan actual`,
        );
      }
    },
  );
});
