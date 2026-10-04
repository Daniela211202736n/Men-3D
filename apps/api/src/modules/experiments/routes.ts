/**
 * Las pruebas A/B desde el backoffice: crear, ver, cerrar.
 *
 * Detras de `ADVANCED_ANALYTICS` —el mismo plan que habilita el panel de
 * metricas— porque sin analitica una prueba A/B no se puede leer: tendria dos
 * variantes y ningun numero.
 *
 * Lo que hay que mirar al tocar esto es **cerrar adoptando B**: ese es el unico
 * momento en que una prueba escribe sobre el plato de verdad. Se hace en una
 * transaccion con el cierre, porque dejar el plato cambiado y la prueba
 * corriendo —o al revés— es peor que cualquiera de los dos.
 */
import {
  ExperimentField,
  experimentCreateSchema,
  experimentStopSchema,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import { resultadosDe } from './resultados.js';

export default async function experimentRoutes(app: FastifyInstance): Promise<void> {
  const gate = { preHandler: [app.requireFeature('ADVANCED_ANALYTICS')] };

  /** Las pruebas del restaurante, con sus numeros. Corriendo primero. */
  app.get('/experiments', gate, async (request) => {
    const { tenantId } = request.authUser!;
    const filas = await prisma.experiment.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      select: { id: true },
      take: 50,
    });

    const resultados = await Promise.all(
      filas.map((f) => resultadosDe(tenantId, f.id)),
    );
    return resultados.filter((r) => r !== null);
  });

  /** Una prueba nueva. */
  app.post('/experiments', gate, async (request, reply) => {
    const { tenantId } = request.authUser!;
    const input = experimentCreateSchema.parse(request.body);

    const dish = await prisma.dish.findFirst({
      where: { id: input.dishId, tenantId, archivedAt: null },
      select: { id: true, priceCents: true, description: true },
    });
    if (!dish) throw notFound('Plato');

    // Probar un valor contra si mismo no mide nada y ocupa el unico lugar de
    // prueba que tiene el plato.
    const actual =
      input.field === ExperimentField.PRICE
        ? String(dish.priceCents)
        : (dish.description ?? '');
    if (actual === input.valueB) {
      throw badRequest(
        'La variante B es igual a lo que ya dice el plato: no hay nada que comparar.',
        'VARIANTE_IGUAL',
      );
    }

    try {
      const creado = await prisma.experiment.create({
        data: {
          tenantId,
          dishId: dish.id,
          field: input.field,
          valueB: input.valueB,
        },
        select: { id: true },
      });
      reply.code(201);
      return (await resultadosDe(tenantId, creado.id))!;
    } catch (error) {
      // El indice unico parcial de la migracion: una prueba corriendo por plato.
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw conflict(
          'Ese plato ya tiene una prueba corriendo. Cerrá esa primero: dos pruebas ' +
            'sobre el mismo plato se pisan y los numeros de las dos quedan sin sentido.',
        );
      }
      throw error;
    }
  });

  /** Cerrar una prueba, y si gana B, adoptar su valor en el plato. */
  app.post('/experiments/:id/stop', gate, async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const { winner } = experimentStopSchema.parse(request.body ?? {});

    const experimento = await prisma.experiment.findFirst({
      where: { id, tenantId },
      select: { id: true, dishId: true, field: true, valueB: true, status: true },
    });
    if (!experimento) throw notFound('Prueba');
    if (experimento.status !== 'RUNNING') throw conflict('Esa prueba ya esta cerrada.');

    // En una transaccion: adoptar el valor y cerrar son un solo hecho. Si
    // quedara el plato cambiado con la prueba corriendo, la mitad de la gente
    // veria el valor nuevo "contra" el valor nuevo.
    await prisma.$transaction(async (tx) => {
      if (winner === 'B') {
        await tx.dish.update({
          where: { id: experimento.dishId },
          data:
            experimento.field === ExperimentField.PRICE
              ? { priceCents: Number.parseInt(experimento.valueB, 10) }
              : { description: experimento.valueB },
        });
      }
      await tx.experiment.update({
        where: { id: experimento.id },
        data: { status: 'STOPPED', stoppedAt: new Date(), winner: winner ?? null },
      });
    });

    return (await resultadosDe(tenantId, experimento.id))!;
  });
}
