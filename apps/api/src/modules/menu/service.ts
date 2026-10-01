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

/**
 * Ids de los platos que coinciden con el texto buscado, ignorando tildes.
 *
 * Va en SQL crudo porque Prisma no sabe expresar `unaccent`, y sin eso la
 * busqueda queda rota para media carta en español: quien escribe "cafe" en el
 * teclado del celular no encuentra "Café cortado", y el restaurante nunca se
 * entera de por que nadie pide ese plato. Tambien al reves —buscar "Café"
 * encuentra "cafe"— porque los dos lados pasan por la misma normalizacion.
 *
 * Devuelve ids y no los platos enteros para no duplicar el resto de los filtros
 * (dietas, alergenos, categoria, archivados): esos los sigue armando Prisma,
 * que es donde se leen. Son dos consultas en vez de una, pero la primera va por
 * indice GIN y devuelve solo ids.
 *
 * Busca en el nombre, la descripcion, los ingredientes y las traducciones: un
 * comensal que puso el telefono en ingles escribe "breaded" y tiene que
 * encontrar la milanesa.
 */
async function buscarIdsDePlatos(tenantId: string, q: string): Promise<string[]> {
  // `%` y `_` son comodines de LIKE: sin escaparlos, buscar "100%" traeria
  // cualquier cosa y "_" cualquier letra. El parametro va ligado, asi que esto
  // no es por inyeccion —de eso se ocupa el driver— sino porque el comensal
  // escribe texto, no patrones.
  const escapado = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const patron = `%${escapado}%`;
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT d."id"
    FROM "Dish" d
    LEFT JOIN "DishIngredient" i ON i."dishId" = d."id"
    LEFT JOIN "DishTranslation" t ON t."dishId" = d."id"
    WHERE d."tenantId" = ${tenantId}
      AND (
        men3d_unaccent(d."name") LIKE men3d_unaccent(${patron})
        OR men3d_unaccent(COALESCE(d."description", '')) LIKE men3d_unaccent(${patron})
        OR men3d_unaccent(COALESCE(i."name", '')) LIKE men3d_unaccent(${patron})
        OR men3d_unaccent(COALESCE(t."name", '')) LIKE men3d_unaccent(${patron})
        OR men3d_unaccent(COALESCE(t."description", '')) LIKE men3d_unaccent(${patron})
      )`;
  return filas.map((f) => f.id);
}

export function buildDishWhere(
  tenantId: string,
  query: MenuQuery,
  idsDeBusqueda?: string[],
): Prisma.DishWhereInput {
  const where: Prisma.DishWhereInput = {
    tenantId,
    archivedAt: null,
    category: { isActive: true },
  };

  // La busqueda por texto NO se arma aca: necesita `unaccent`, que Prisma no
  // sabe expresar. La resuelve `buscarIdsDePlatos` y llega ya resuelta en
  // `idsDeBusqueda`.
  if (idsDeBusqueda) where.id = { in: idsDeBusqueda };

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

  // Solo cuando hay texto: sin busqueda no hay por que pagar una consulta mas.
  const idsDeBusqueda = query.q
    ? await buscarIdsDePlatos(tenant.id, query.q)
    : undefined;

  const [categories, dishes, ratings, venueRating] = await Promise.all([
    prisma.category.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { translations: true },
    }),
    prisma.dish.findMany({
      where: buildDishWhere(tenant.id, query, idsDeBusqueda),
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
