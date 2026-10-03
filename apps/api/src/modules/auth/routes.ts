/**
 * Alta de restaurantes (self-service) y login del backoffice.
 */
import {
  PLAN_FEATURES,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerTenantSchema,
  resetPasswordSchema,
  type AuthResponseDto,
  type Feature,
  type PlanTier,
  type UserRole,
} from '@men3d/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { conflict, unauthorized } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import { getTenantFeatures } from '../../plugins/auth.js';
import {
  cambiarContrasenia,
  restablecerContrasenia,
  solicitarRestablecimiento,
} from './password-reset.js';

/** Coste de bcrypt: 12 rondas es el equilibrio habitual hoy. */
const BCRYPT_ROUNDS = 12;

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Alta de un restaurante nuevo con su dueño. Crea tenant + branding por
   * defecto + suscripcion en prueba, todo en una transaccion: si algo falla no
   * queda un restaurante a medio crear.
   */
  app.post('/register', async (request, reply) => {
    const input = registerTenantSchema.parse(request.body);

    const [slugTaken, emailTaken] = await Promise.all([
      prisma.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    ]);
    if (slugTaken) throw conflict(`La direccion /m/${input.slug} ya esta tomada`);
    if (emailTaken) throw conflict('Ya existe una cuenta con ese email');

    const trialPlan =
      (await prisma.plan.findUnique({ where: { tier: 'PRO' } })) ??
      (await prisma.plan.findFirst());

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const tenant = await prisma.tenant.create({
      data: {
        slug: input.slug,
        name: input.restaurantName,
        currency: input.currency,
        defaultLocale: input.locale,
        enabledLocales: input.locale,
        branding: { create: {} },
        users: {
          create: {
            email: input.email,
            name: input.ownerName,
            passwordHash,
            role: 'OWNER',
          },
        },
        ...(trialPlan
          ? {
              subscription: {
                create: {
                  planId: trialPlan.id,
                  status: 'TRIALING',
                  // 14 dias de prueba del plan PRO: el dueño ve todo antes de pagar.
                  trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                },
              },
            }
          : {}),
      },
      include: { users: true },
    });

    const user = tenant.users[0]!;
    const token = app.jwt.sign({
      sub: user.id,
      tenantId: tenant.id,
      role: user.role as UserRole,
      email: user.email,
    });

    const features = await getTenantFeatures(tenant.id);
    const response: AuthResponseDto = {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
      },
      plan: {
        tier: (trialPlan?.tier as PlanTier) ?? 'FREE',
        features: features.length
          ? features
          : [...(PLAN_FEATURES[(trialPlan?.tier as PlanTier) ?? 'FREE'] ?? [])],
      },
    };
    return reply.status(201).send(response);
  });

  app.post('/login', async (request) => {
    const input = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { tenant: { include: { subscription: { include: { plan: true } } } } },
    });

    // Se compara igual contra un hash ficticio cuando el usuario no existe,
    // para que el tiempo de respuesta no delate que el email no esta registrado.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(input.password, hash);
    if (!user || !ok || !user.isActive) throw unauthorized();

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = app.jwt.sign({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role as UserRole,
      email: user.email,
    });

    const features = await getTenantFeatures(user.tenantId);
    const response: AuthResponseDto = {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
      plan: {
        tier: (user.tenant.subscription?.plan.tier as PlanTier) ?? 'FREE',
        features: features as Feature[],
      },
    };
    return response;
  });

  /**
   * Pide un enlace para restablecer la contraseña.
   *
   * Responde siempre 202, exista o no la cuenta: distinguir los casos
   * convertiria este formulario en un detector de emails registrados.
   */
  app.post('/forgot-password', async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    try {
      await solicitarRestablecimiento(email);
    } catch (error) {
      // El envio del correo ya va sin esperar y se registra aparte; lo que puede
      // fallar aca es la base. Tampoco eso debe revelar nada ni romper la
      // pantalla: queda en el log para quien opera.
      request.log.error({ err: error }, 'fallo al preparar la recuperacion');
    }
    return reply.status(202).send({
      message: 'Si existe una cuenta con ese email, va a recibir un enlace.',
    });
  });

  /** Fija la contraseña nueva con el token del enlace. */
  app.post('/reset-password', async (request) => {
    const input = resetPasswordSchema.parse(request.body);
    await restablecerContrasenia(input.token, input.password);
    return { message: 'Contraseña actualizada. Ya podes entrar con la nueva.' };
  });

  /** Cambio de contraseña desde dentro de la sesion. */
  app.post(
    '/change-password',
    { preHandler: [app.requireAuth] },
    async (request) => {
      const input = changePasswordSchema.parse(request.body);
      await cambiarContrasenia(
        request.authUser!.sub,
        input.currentPassword,
        input.newPassword,
      );
      return { message: 'Contraseña actualizada.' };
    },
  );

  /** Rehidrata la sesion del backoffice al recargar la pagina. */
  app.get('/me', { preHandler: [app.requireAuth] }, async (request) => {
    const auth = request.authUser!;
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.sub },
      include: { tenant: { include: { subscription: { include: { plan: true } } } } },
    });
    const features = await getTenantFeatures(auth.tenantId);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
      plan: {
        tier: (user.tenant.subscription?.plan.tier as PlanTier) ?? 'FREE',
        features,
      },
    };
  });
}
