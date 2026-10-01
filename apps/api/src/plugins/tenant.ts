/**
 * Resolucion del tenant publico a partir del slug de la URL (/m/:slug).
 *
 * Alternativa en produccion: resolver por subdominio (mirestaurante.men3d.app).
 * `resolveTenantFromHost` queda lista para ese caso; la ruta por slug es la que
 * usa el MVP porque no necesita DNS wildcard.
 */
import type { Feature } from '@men3d/shared';
import type { Branding, Tenant } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { notFound } from '../lib/errors.js';
import { prisma } from '../prisma.js';
import { getTenantFeatures } from './auth.js';

export type PublicTenant = Tenant & { branding: Branding | null };

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: PublicTenant;
    tenantFeatures?: Feature[];
  }
  interface FastifyInstance {
    resolveTenant: (request: FastifyRequest) => Promise<void>;
  }
}

/** Devuelve el slug candidato de un host tipo `slug.men3d.app`. */
export function resolveTenantFromHost(host: string | undefined): string | null {
  if (!host) return null;
  const [hostname] = host.split(':');
  const parts = (hostname ?? '').split('.');
  if (parts.length < 3) return null;
  const [sub] = parts;
  if (!sub || ['www', 'api', 'app', 'admin'].includes(sub)) return null;
  return sub;
}

export default fp(async (app) => {
  app.decorate('resolveTenant', async (request: FastifyRequest) => {
    const params = request.params as { slug?: string } | undefined;
    const slug = params?.slug ?? resolveTenantFromHost(request.headers.host);
    if (!slug) throw notFound('Restaurante');

    const tenant = await prisma.tenant.findFirst({
      where: { slug, isActive: true },
      include: { branding: true },
    });
    if (!tenant) throw notFound('Restaurante');

    request.tenant = tenant;
    request.tenantFeatures = await getTenantFeatures(tenant.id);
  });
});

/** Acceso tipado al tenant ya resuelto (evita el `!` en cada handler). */
export function tenantOf(request: FastifyRequest): PublicTenant {
  const tenant = request.tenant;
  if (!tenant) throw notFound('Restaurante');
  return tenant;
}
