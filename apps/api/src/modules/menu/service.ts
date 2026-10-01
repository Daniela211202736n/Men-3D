/**
 * Lectura de la carta publica: busqueda incremental, filtros de dieta y
 * alergenos, y resolucion de idioma.
 */
import {
  DEFAULT_LOCALE,
  isLocale,
  type DishDto,
  type Locale,
  type MenuDto,
  type MenuQuery,
  type RatingSummaryDto,
} from '@men3d/shared';
import type { Prisma } from '@prisma/client';

import {
  buildRatingSummary,
  toCategoryDto,
  toDishDto,
  toVenueDto,
  EMPTY_RATING,
  type RatingIndex,
} from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import type { PublicTenant } from '../../plugins/tenant.js';
import { getTenantFeatures } from '../../plugins/auth.js';

const dishInclude = {
  category: { select: { id: true, name: true } },
  allergens: true,
  dietTags: true,
  ingredients: true,
  translations: true,
} satisfies Prisma.DishInclude;

/**
 * Calificaciones de todos los platos del tenant en una sola consulta agregada,
 * en vez de una por plato (evita el N+1 que mataria el menu en el celular).
 */
export async function loadDishRatings(tenantId: string): Promise<RatingIndex> {
  const grouped = await prisma.review.groupBy({
    by: ['dishId', 'rating'],
    where: { tenantId, status: 'PUBLISHED', dishId: { not: null } },
    _count: { _all: true },
  });

  const byDish = new Map<string, Array<{ rating: number; count: number }>>();
  for (const row of grouped) {
    if (!row.dishId) continue;
    const list = byDish.get(row.dishId) ?? [];
    list.push({ rating: row.rating, count: row._count._all });
    byDish.set(row.dishId, list);
  }

  const index: RatingIndex = new Map();
  for (const [dishId, rows] of byDish) {
    index.set(dishId, buildRatingSummary(rows));
  }
  return index;
}

/** Calificacion general del local (reseñas sin plato asociado). */
export async function loadVenueRating(
  tenantId: string,
): Promise<RatingSummaryDto> {
  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { tenantId, status: 'PUBLISHED', dishId: null },
    _count: { _all: true },
  });
  if (grouped.length === 0) return EMPTY_RATING;
  return buildRatingSummary(
    grouped.map((g) => ({ rating: g.rating, count: g._count._all })),
  );
}

/** Idioma efectivo: el pedido si el tenant lo ofrece, si no el suyo por defecto. */
export function resolveLocale(
  tenant: PublicTenant,
  requested: string | undefined,
  enabled: Locale[],
): Locale {
  if (requested && isLocale(requested) && enabled.includes(requested)) {
    return requested;
  }
  const fallback = tenant.defaultLocale;
  return isLocale(fallback) ? fallback : DEFAULT_LOCALE;
}

export function buildDishWhere(
  tenantId: string,
  query: MenuQuery,
): Prisma.DishWhereInput {
  const where: Prisma.DishWhereInput = {
    tenantId,
    archivedAt: null,
    category: { isActive: true },
  };

  if (query.q) {
    const q = query.q;
    // `mode: 'insensitive'` no es opcional: sin el, PostgreSQL distingue
    // mayusculas y buscar "Milanesa" no encuentra "milanesa napolitana".
    //
    // Sigue siendo una busqueda por subcadena: no ignora tildes ni tolera
    // errores de tipeo. Para eso hacen falta las extensiones `unaccent` y
    // `pg_trgm` con un indice GIN — anotado en docs/ROADMAP.md.
    const like = { contains: q, mode: 'insensitive' } as const;
    where.OR = [
      { name: like },
      { description: like },
      { ingredients: { some: { name: like } } },
      { translations: { some: { name: like } } },
    ];
  }

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.only3d) where.modelGlbUrl = { not: null };

  // Dietas: el plato debe cumplir TODAS las pedidas (celiaco + vegano).
  if (query.diets?.length) {
    where.AND = query.diets.map((tag) => ({ dietTags: { some: { tag } } }));
  }

  // Alergenos: se excluye el plato si declara cualquiera de los indicados.
  // `mayContain` tambien excluye: ante una alergia, las trazas importan.
  if (query.excludeAllergens?.length) {
    where.allergens = {
      none: { allergen: { in: [...query.excludeAllergens] } },
    };
  }

  return where;
}

export interface MenuResult extends MenuDto {
  /** Cantidad de platos que coincidieron (para el informe de busquedas). */
  matchCount: number;
}

export async function getMenu(
  tenant: PublicTenant,
  query: MenuQuery,
): Promise<MenuResult> {
  const features = await getTenantFeatures(tenant.id);
  const enabledLocales = (tenant.enabledLocales || DEFAULT_LOCALE)
    .split(',')
    .map((l) => l.trim())
    .filter(isLocale);
  const locale = resolveLocale(tenant, query.locale, enabledLocales);
  const sourceLocale = isLocale(tenant.defaultLocale)
    ? tenant.defaultLocale
    : DEFAULT_LOCALE;

  const [categories, dishes, ratings, venueRating] = await Promise.all([
    prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { translations: true },
    }),
    prisma.dish.findMany({
      where: buildDishWhere(tenant.id, query),
      // Destacados primero, luego el orden manual del dueño, luego alfabetico.
      orderBy: [
        { isFeatured: 'desc' },
        { position: 'asc' },
        { name: 'asc' },
      ],
      include: dishInclude,
    }),
    loadDishRatings(tenant.id),
    loadVenueRating(tenant.id),
  ]);

  const dishesByCategory = new Map<string, number>();
  for (const dish of dishes) {
    dishesByCategory.set(
      dish.categoryId,
      (dishesByCategory.get(dish.categoryId) ?? 0) + 1,
    );
  }

  const dishDtos: DishDto[] = dishes.map((dish) =>
    toDishDto(dish, {
      currency: tenant.currency,
      locale,
      sourceLocale,
      rating: ratings.get(dish.id),
    }),
  );

  return {
    venue: toVenueDto(tenant, venueRating, features),
    // Se ocultan las categorias que quedaron vacias tras aplicar los filtros.
    categories: categories
      .map((c) => toCategoryDto(c, locale, dishesByCategory.get(c.id) ?? 0))
      .filter((c) => c.dishCount > 0 || !hasFilters(query)),
    dishes: dishDtos,
    locale,
    matchCount: dishDtos.length,
  };
}

function hasFilters(query: MenuQuery): boolean {
  return Boolean(
    query.q ||
      query.categoryId ||
      query.only3d ||
      query.diets?.length ||
      query.excludeAllergens?.length,
  );
}

export async function getDishDetail(
  tenant: PublicTenant,
  dishId: string,
  localeParam: string | undefined,
): Promise<DishDto | null> {
  const enabledLocales = (tenant.enabledLocales || DEFAULT_LOCALE)
    .split(',')
    .map((l) => l.trim())
    .filter(isLocale);
  const locale = resolveLocale(tenant, localeParam, enabledLocales);
  const sourceLocale = isLocale(tenant.defaultLocale)
    ? tenant.defaultLocale
    : DEFAULT_LOCALE;

  const dish = await prisma.dish.findFirst({
    where: { id: dishId, tenantId: tenant.id, archivedAt: null },
    include: dishInclude,
  });
  if (!dish) return null;

  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { dishId: dish.id, status: 'PUBLISHED' },
    _count: { _all: true },
  });

  return toDishDto(dish, {
    currency: tenant.currency,
    locale,
    sourceLocale,
    rating: grouped.length
      ? buildRatingSummary(
          grouped.map((g) => ({ rating: g.rating, count: g._count._all })),
        )
      : EMPTY_RATING,
  });
}

export { dishInclude };
