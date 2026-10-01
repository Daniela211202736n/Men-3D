/**
 * Backoffice — equipo del restaurante.
 *
 * Reglas que no son negociables y por que:
 *
 *  - Solo OWNER y ADMIN administran el equipo; STAFF (la pantalla de cocina) no
 *    puede ni listar quien trabaja ahi.
 *  - Nadie puede cambiarse el rol a si mismo ni desactivarse: seria la forma mas
 *    rapida de quedarse afuera del propio backoffice.
 *  - Siempre tiene que quedar al menos un OWNER activo. Sin eso, un restaurante
 *    puede quedar sin nadie que pueda cambiar el plan ni ceder la titularidad.
 *  - Un ADMIN no puede tocar a un OWNER: solo un OWNER administra a otro OWNER.
 */
import {
  teamUserCreateSchema,
  teamUserUpdateSchema,
  type TeamUserDto,
  type UserRole,
} from '@men3d/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { User } from '@prisma/client';

import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';

const BCRYPT_ROUNDS = 12;

function toTeamUserDto(user: User, selfId: string): TeamUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as UserRole,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    isSelf: user.id === selfId,
  };
}

/**
 * Ejecuta un cambio sobre un dueño sin que pueda quedar el restaurante sin
 * ninguno.
 *
 * Contar y despues escribir en dos pasos sueltos no alcanza: dos pedidos
 * simultaneos —dos administradores dando de baja a los dos ultimos dueños—
 * leerian ambos "quedan 2" y escribirian los dos, dejando cero. Y un
 * restaurante sin dueño activo no tiene quien cambie el plan ni ceda la
 * titularidad: hay que entrar a la base a mano para arreglarlo.
 *
 * El `FOR UPDATE` bloquea las filas de los dueños de ESE restaurante mientras
 * dura la transaccion, asi que el segundo pedido espera, vuelve a contar y se
 * encuentra con el limite. Bloquea solo a los dueños de un tenant: dos locales
 * distintos no se estorban.
 */
async function cambiandoAUnDueño<T>(
  tenantId: string,
  trabajo: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], activos: number) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "User"
      WHERE "tenantId" = ${tenantId} AND "role" = 'OWNER' AND "isActive" = true
      FOR UPDATE`;
    const activos = await tx.user.count({
      where: { tenantId, role: 'OWNER', isActive: true },
    });
    return trabajo(tx, activos);
  });
}

export default async function adminTeamRoutes(app: FastifyInstance): Promise<void> {
  const soloAdministradores = app.requireRole('OWNER', 'ADMIN');

  app.get('/users', { preHandler: [soloAdministradores] }, async (request) => {
    const { tenantId, sub } = request.authUser!;
    const users = await prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return users.map((u) => toTeamUserDto(u, sub));
  });

  app.post('/users', { preHandler: [soloAdministradores] }, async (request, reply) => {
    const { tenantId, sub } = request.authUser!;
    const input = teamUserCreateSchema.parse(request.body);

    // El email es unico a nivel plataforma: si ya existe, no se dice de que
    // restaurante es.
    const existente = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existente) throw conflict('Ya existe una cuenta con ese email');

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
    });

    return reply.status(201).send(toTeamUserDto(user, sub));
  });

  app.patch('/users/:id', { preHandler: [soloAdministradores] }, async (request) => {
    const { tenantId, sub, role: miRol } = request.authUser!;
    const { id } = request.params as { id: string };
    const input = teamUserUpdateSchema.parse(request.body);

    const objetivo = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!objetivo) throw notFound('Usuario');

    const esYoMismo = objetivo.id === sub;

    // Cambiarse el rol o desactivarse a uno mismo es la forma mas rapida de
    // quedarse afuera del propio backoffice.
    if (esYoMismo && input.role !== undefined) {
      throw badRequest('No podes cambiar tu propio rol', 'SELF_ROLE_CHANGE');
    }
    if (esYoMismo && input.isActive === false) {
      throw badRequest('No podes desactivar tu propia cuenta', 'SELF_DEACTIVATE');
    }

    if (objetivo.role === 'OWNER' && miRol !== 'OWNER') {
      throw forbidden('Solo un dueño puede administrar a otro dueño');
    }

    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };

    // Quitarle el rol a un OWNER, o desactivarlo, no puede dejar al restaurante
    // sin ninguno. Cualquier cambio de rol sobre un dueño lo degrada: el
    // esquema no admite asignar OWNER, que solo se da transfiriendo.
    const dejariaDeSerOwner =
      objetivo.role === 'OWNER' &&
      (input.isActive === false || input.role !== undefined);

    if (!dejariaDeSerOwner) {
      const actualizado = await prisma.user.update({ where: { id }, data });
      return toTeamUserDto(actualizado, sub);
    }

    const actualizado = await cambiandoAUnDueño(tenantId, async (tx, activos) => {
      if (activos <= 1) {
        throw conflict(
          'Es el unico dueño activo. Nombra otro dueño antes de cambiar este.',
        );
      }
      return tx.user.update({ where: { id }, data });
    });
    return toTeamUserDto(actualizado, sub);
  });

  /**
   * Transferir la titularidad. Es la unica forma de crear otro OWNER, y la hace
   * el OWNER actual: asi la cuenta siempre tiene dueño y nunca dos por error.
   */
  app.post(
    '/users/:id/transfer-ownership',
    { preHandler: [app.requireRole('OWNER')] },
    async (request) => {
      const { tenantId, sub } = request.authUser!;
      const { id } = request.params as { id: string };

      if (id === sub) throw badRequest('Ya sos el dueño');

      const objetivo = await prisma.user.findFirst({
        where: { id, tenantId, isActive: true },
      });
      if (!objetivo) throw notFound('Usuario');

      // En una transaccion: en ningun instante hay dos dueños ni ninguno.
      const [nuevo] = await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { role: 'OWNER' } }),
        prisma.user.update({ where: { id: sub }, data: { role: 'ADMIN' } }),
      ]);
      return toTeamUserDto(nuevo, sub);
    },
  );

  /**
   * Da de baja a un integrante. Es desactivacion, no borrado: el usuario puede
   * figurar en el historial de acciones y su email sigue reservado.
   */
  app.delete('/users/:id', { preHandler: [soloAdministradores] }, async (request) => {
    const { tenantId, sub, role: miRol } = request.authUser!;
    const { id } = request.params as { id: string };

    if (id === sub) {
      throw badRequest('No podes darte de baja a vos mismo', 'SELF_DEACTIVATE');
    }

    const objetivo = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!objetivo) throw notFound('Usuario');

    if (objetivo.role === 'OWNER' && miRol !== 'OWNER') {
      throw forbidden('Solo un dueño puede dar de baja a otro dueño');
    }

    if (objetivo.role !== 'OWNER') {
      const actualizado = await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });
      return toTeamUserDto(actualizado, sub);
    }

    const actualizado = await cambiandoAUnDueño(tenantId, async (tx, activos) => {
      if (activos <= 1) {
        throw conflict('Es el unico dueño activo. Transferí la titularidad primero.');
      }
      return tx.user.update({ where: { id }, data: { isActive: false } });
    });
    return toTeamUserDto(actualizado, sub);
  });
}
