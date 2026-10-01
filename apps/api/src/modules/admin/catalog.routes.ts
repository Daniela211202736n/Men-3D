/**
 * Backoffice — gestion de la carta.
 *
 * El `tenantId` sale siempre del token (nunca del body ni de la URL), y cada
 * `update`/`delete` filtra por el: aunque alguien adivine el id de un plato de
 * otro restaurante, la consulta no lo encuentra.
 */
import {
  categoryUpsertSchema,
  dishUpsertSchema,
  priceUpdateSchema,
  reorderSchema,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { conflict, notFound } from '../../lib/errors.js';
import { verificarLimiteDeModelos, verificarLimiteDePlatos } from './plan-limits.js';
import { toCategoryDto, toDishDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import { dishInclude } from '../menu/service.js';
import type { Locale } from '@men3d/shared';

/** Datos del tenant que casi todo handler necesita (moneda e idioma origen). */
async function tenantContext(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, defaultLocale: true },
  });
  return {
    currency: tenant.currency,
    sourceLocale: tenant.defaultLocale as Locale,
  };
}

export default async function adminCatalogRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ----------------------------------------------------------- categorias
  app.get('/categories', async (request) => {
    const { tenantId } = request.authUser!;
    const categories = await prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: {
        translations: true,
        _count: { select: { dishes: { where: { archivedAt: null } } } },
      },
    });
    const locale = (await tenantContext(tenantId)).sourceLocale;
    return categories.map((c) => toCategoryDto(c, locale, c._count.dishes));
  });

  app.post('/categories', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const input = categoryUpsertSchema.parse(request.body);

    // Nueva categoria al final, salvo que se indique posicion.
    const last = await prisma.category.findFirst({
      where: { tenantId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const category = await prisma.category.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        position: input.position ?? (last ? last.position + 1 : 0),
        isActive: input.isActive ?? true,
      },
    });
    return reply.status(201).send(category);
  });

  app.patch('/categories/:id', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const input = categoryUpsertSchema.partial().parse(request.body);

    const result = await prisma.category.updateMany({
      where: { id, tenantId },
      data: input,
    });
    if (result.count === 0) throw notFound('Categoria');
    return prisma.category.findUniqueOrThrow({ where: { id } });
  });

  app.delete('/categories/:id', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };

    const dishCount = await prisma.dish.count({
      where: { categoryId: id, tenantId, archivedAt: null },
    });
    if (dishCount > 0) {
      throw conflict(
        `La categoria tiene ${dishCount} plato(s). Movelos o dalos de baja primero.`,
      );
    }
    const result = await prisma.category.deleteMany({ where: { id, tenantId } });
    if (result.count === 0) throw notFound('Categoria');
    return reply.status(204).send();
  });

  /** Reordenar categorias: llega la lista completa de ids en el orden deseado. */
  app.put('/categories/order', async (request) => {
    const { tenantId } = request.authUser!;
    const { ids } = reorderSchema.parse(request.body);
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.category.updateMany({
          where: { id, tenantId },
          data: { position: index },
        }),
      ),
    );
    return { updated: ids.length };
  });

  // --------------------------------------------------------------- platos
  app.get('/dishes', async (request) => {
    const { tenantId } = request.authUser!;
    const raw = request.query as { includeArchived?: string; categoryId?: string };
    const { currency, sourceLocale } = await tenantContext(tenantId);

    const dishes = await prisma.dish.findMany({
      where: {
        tenantId,
        ...(raw.includeArchived === 'true' ? {} : { archivedAt: null }),
        ...(raw.categoryId ? { categoryId: raw.categoryId } : {}),
      },
      include: dishInclude,
      orderBy: [{ isFeatured: 'desc' }, { position: 'asc' }, { name: 'asc' }],
    });

    return dishes.map((dish) =>
      toDishDto(dish, { currency, locale: sourceLocale, sourceLocale }),
    );
  });

  app.post('/dishes', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const input = dishUpsertSchema.parse(request.body);

    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, tenantId },
      select: { id: true },
    });
    if (!category) throw notFound('Categoria');

    // Antes de crear, no despues: un 403 con el motivo es mejor que crear y
    // revertir.
    await verificarLimiteDePlatos(tenantId);
    if (input.modelGlbUrl) await verificarLimiteDeModelos(tenantId);

    const last = await prisma.dish.findFirst({
      where: { tenantId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const dish = await prisma.dish.create({
      data: {
        tenantId,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description ?? null,
        priceCents: input.priceCents,
        compareAtPriceCents: input.compareAtPriceCents ?? null,
        imageUrl: input.imageUrl ?? null,
        modelGlbUrl: input.modelGlbUrl ?? null,
        modelUsdzUrl: input.modelUsdzUrl ?? null,
        portionGrams: input.portionGrams ?? null,
        calories: input.calories ?? null,
        prepMinutes: input.prepMinutes ?? null,
        isAvailable: input.isAvailable ?? true,
        isFeatured: input.isFeatured ?? false,
        position: input.position ?? (last ? last.position + 1 : 0),
        allergens: {
          create: (input.allergens ?? []).map((allergen) => ({ allergen })),
        },
        dietTags: { create: (input.dietTags ?? []).map((tag) => ({ tag })) },
        ingredients: {
          create: (input.ingredients ?? []).map((name, position) => ({
            name,
            position,
          })),
        },
      },
      include: dishInclude,
    });

    const { currency, sourceLocale } = await tenantContext(tenantId);
    return reply
      .status(201)
      .send(toDishDto(dish, { currency, locale: sourceLocale, sourceLocale }));
  });

  app.patch('/dishes/:id', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const input = dishUpsertSchema.partial().parse(request.body);

    const existing = await prisma.dish.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw notFound('Plato');

    if (input.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: input.categoryId, tenantId },
        select: { id: true },
      });
      if (!category) throw notFound('Categoria');
    }

    // Poner un modelo donde no habia suma uno a la cuenta; reemplazarlo, no.
    if (input.modelGlbUrl) await verificarLimiteDeModelos(tenantId, id);

    const { allergens, dietTags, ingredients, ...scalars } = input;

    // Las colecciones se reemplazan completas: es lo que espera el formulario
    // del backoffice (manda el estado final, no un delta).
    await prisma.$transaction(async (tx) => {
      await tx.dish.update({ where: { id }, data: scalars });

      if (allergens) {
        await tx.dishAllergen.deleteMany({ where: { dishId: id } });
        if (allergens.length) {
          await tx.dishAllergen.createMany({
            data: allergens.map((allergen) => ({ dishId: id, allergen })),
          });
        }
      }
      if (dietTags) {
        await tx.dishDietTag.deleteMany({ where: { dishId: id } });
        if (dietTags.length) {
          await tx.dishDietTag.createMany({
            data: dietTags.map((tag) => ({ dishId: id, tag })),
          });
        }
      }
      if (ingredients) {
        await tx.dishIngredient.deleteMany({ where: { dishId: id } });
        if (ingredients.length) {
          await tx.dishIngredient.createMany({
            data: ingredients.map((name, position) => ({
              dishId: id,
              name,
              position,
            })),
          });
        }
      }
    });

    const dish = await prisma.dish.findUniqueOrThrow({
      where: { id },
      include: dishInclude,
    });
    const { currency, sourceLocale } = await tenantContext(tenantId);
    return toDishDto(dish, { currency, locale: sourceLocale, sourceLocale });
  });

  /** Cambio de precio en tiempo real: el caso de uso mas frecuente del dueño. */
  app.patch('/dishes/:id/price', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const { priceCents } = priceUpdateSchema.parse(request.body);

    const result = await prisma.dish.updateMany({
      where: { id, tenantId },
      data: { priceCents },
    });
    if (result.count === 0) throw notFound('Plato');
    return { id, priceCents };
  });

  /** Disponible / agotado sin entrar a editar el plato. */
  app.patch('/dishes/:id/availability', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const { isAvailable } = request.body as { isAvailable: boolean };

    const result = await prisma.dish.updateMany({
      where: { id, tenantId },
      data: { isAvailable: Boolean(isAvailable) },
    });
    if (result.count === 0) throw notFound('Plato');
    return { id, isAvailable: Boolean(isAvailable) };
  });

  app.put('/dishes/order', async (request) => {
    const { tenantId } = request.authUser!;
    const { ids } = reorderSchema.parse(request.body);
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.dish.updateMany({
          where: { id, tenantId },
          data: { position: index },
        }),
      ),
    );
    return { updated: ids.length };
  });

  /**
   * Baja de un plato. Es logica (`archivedAt`): si se borrara de verdad se
   * perderian los pedidos historicos y la analitica que lo referencian.
   */
  app.delete('/dishes/:id', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const result = await prisma.dish.updateMany({
      where: { id, tenantId, archivedAt: null },
      data: { archivedAt: new Date(), isAvailable: false },
    });
    if (result.count === 0) throw notFound('Plato');
    return { id, archived: true };
  });

  app.post('/dishes/:id/restore', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    // Restaurar vuelve a ocupar un lugar en el plan.
    await verificarLimiteDePlatos(tenantId);
    const result = await prisma.dish.updateMany({
      where: { id, tenantId },
      data: { archivedAt: null },
    });
    if (result.count === 0) throw notFound('Plato');
    return { id, archived: false };
  });

  // ------------------------------------------------------------ maridajes
  app.get('/dishes/:id/pairings', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    return prisma.pairing.findMany({
      where: { tenantId, dishId: id },
      orderBy: { weight: 'desc' },
      include: { suggestedDish: { select: { id: true, name: true } } },
    });
  });

  app.post('/dishes/:id/pairings', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const body = request.body as {
      suggestedDishId: string;
      weight?: number;
      blurb?: string;
    };

    const both = await prisma.dish.findMany({
      where: { id: { in: [id, body.suggestedDishId] }, tenantId },
      select: { id: true },
    });
    if (both.length !== 2) throw notFound('Plato');

    const pairing = await prisma.pairing.upsert({
      where: {
        dishId_suggestedDishId: {
          dishId: id,
          suggestedDishId: body.suggestedDishId,
        },
      },
      create: {
        tenantId,
        dishId: id,
        suggestedDishId: body.suggestedDishId,
        reason: 'CURATED',
        weight: body.weight ?? 50,
        blurb: body.blurb ?? null,
      },
      update: { weight: body.weight ?? 50, blurb: body.blurb ?? null },
    });
    return reply.status(201).send(pairing);
  });

  app.delete('/pairings/:pairingId', async (request, reply) => {
    const { tenantId } = request.authUser!;
    const { pairingId } = request.params as { pairingId: string };
    const result = await prisma.pairing.deleteMany({
      where: { id: pairingId, tenantId },
    });
    if (result.count === 0) throw notFound('Maridaje');
    return reply.status(204).send();
  });
}
