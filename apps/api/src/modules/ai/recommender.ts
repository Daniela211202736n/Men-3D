/**
 * Recomendador de maridajes ("IA sugestiva").
 *
 * Es deterministico y explicable a proposito: cada sugerencia sale con un
 * motivo que se le muestra al comensal. Combina tres señales, de mas a menos
 * confiable:
 *
 *   1. CURADO            — el restaurante lo definio a mano (manda siempre).
 *   2. CO-CONSUMO        — se pidieron juntos en pedidos reales del local.
 *   3. CURSO COMPLEMENTARIO — heuristica de categoria (plato -> bebida/postre).
 *
 * Despues filtra por compatibilidad de dieta: a quien eligio un plato vegano no
 * se le ofrece algo que no lo sea. El texto de cada sugerencia lo puede pulir
 * Claude (ver ./claude.ts), pero el *que* sugerir nunca depende de la IA.
 */
import {
  PairingReason,
  type DietTag,
  type Locale,
  type PairingDto,
} from '@men3d/shared';

import { toDishDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import type { PublicTenant } from '../../plugins/tenant.js';
import { dishInclude } from '../menu/service.js';
import { writePairingBlurb } from './claude.js';

/** Palabras que delatan la categoria, en los idiomas que soportamos. */
const CATEGORY_HINTS = {
  drink: [
    'bebida', 'vino', 'cerveza', 'trago', 'coctel', 'cafe', 'jugo', 'gaseosa',
    'drink', 'wine', 'beer', 'cocktail', 'coffee', 'juice', 'soda',
    'boisson', 'vinho', 'bebidas', 'getranke', 'bibite',
  ],
  dessert: [
    'postre', 'dulce', 'helado', 'torta', 'dessert', 'sweet', 'ice cream',
    'cake', 'sobremesa', 'dolci', 'nachtisch',
  ],
  starter: [
    'entrada', 'picada', 'tapa', 'aperitivo', 'starter', 'appetizer',
    'antipasti', 'vorspeise', 'entree',
  ],
  main: [
    'principal', 'plato', 'parrilla', 'carne', 'pasta', 'pizza', 'main',
    'burger', 'hamburguesa', 'milanesa', 'sandwich',
  ],
} as const;

type CourseKind = keyof typeof CATEGORY_HINTS | 'other';

function classifyCategory(name: string): CourseKind {
  const normalized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  for (const kind of ['drink', 'dessert', 'starter', 'main'] as const) {
    if (CATEGORY_HINTS[kind].some((hint) => normalized.includes(hint))) {
      return kind;
    }
  }
  return 'other';
}

/** Que cursos complementan a cual, y con cuanta fuerza. */
const COMPLEMENTS: Record<CourseKind, Partial<Record<CourseKind, number>>> = {
  main: { drink: 0.55, dessert: 0.45, starter: 0.3 },
  starter: { main: 0.5, drink: 0.4 },
  dessert: { drink: 0.35 },
  drink: { main: 0.4, dessert: 0.3 },
  other: { drink: 0.3, dessert: 0.25 },
};

/**
 * Si el plato elegido es apto para una dieta restrictiva, la sugerencia tambien
 * tiene que serlo: romper eso es peor que no sugerir nada.
 */
const STRICT_DIETS: DietTag[] = ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE'];

interface Candidate {
  dishId: string;
  score: number;
  reason: PairingReason;
  blurb: string | null;
}

export interface PairingOptions {
  limit?: number;
  locale: Locale;
  /** Pide a la IA el copy de las sugerencias que no tienen uno curado. */
  withAiCopy?: boolean;
}

export async function getPairings(
  tenant: PublicTenant,
  dishId: string,
  options: PairingOptions,
): Promise<PairingDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 3, 1), 8);

  const source = await prisma.dish.findFirst({
    where: { id: dishId, tenantId: tenant.id, archivedAt: null },
    include: { category: true, dietTags: true },
  });
  if (!source) return [];

  const candidates = new Map<string, Candidate>();
  /** Solo mejora una sugerencia si la nueva señal es mas fuerte. */
  const offer = (c: Candidate) => {
    if (c.dishId === dishId) return;
    const existing = candidates.get(c.dishId);
    if (!existing || c.score > existing.score) candidates.set(c.dishId, c);
  };

  // --- 1. maridajes curados por el restaurante ----------------------------
  const curated = await prisma.pairing.findMany({
    where: { tenantId: tenant.id, dishId },
    orderBy: { weight: 'desc' },
    take: 12,
  });
  for (const pairing of curated) {
    offer({
      dishId: pairing.suggestedDishId,
      // El peso manual (0..100) se normaliza al tramo 0,6..1 para que un
      // maridaje curado siempre le gane a una señal estadistica.
      score: 0.6 + Math.min(Math.max(pairing.weight, 0), 100) / 250,
      reason: (pairing.reason as PairingReason) ?? PairingReason.CURATED,
      blurb: pairing.blurb,
    });
  }

  // --- 2. co-consumo historico -------------------------------------------
  const coOccurrence = await loadCoOccurrence(tenant.id, dishId);
  for (const [candidateId, { together, total }] of coOccurrence) {
    // Confianza = P(pedir B | se pidio A). Se exige una base minima de
    // pedidos para no sacar conclusiones de dos casos sueltos.
    if (total < 3) continue;
    offer({
      dishId: candidateId,
      score: 0.3 + 0.3 * (together / total),
      reason: PairingReason.FREQUENTLY_TOGETHER,
      blurb: null,
    });
  }

  // --- 3. curso complementario -------------------------------------------
  const sourceCourse = classifyCategory(source.category?.name ?? '');
  const wanted = COMPLEMENTS[sourceCourse] ?? {};
  if (Object.keys(wanted).length > 0) {
    const others = await prisma.dish.findMany({
      where: {
        tenantId: tenant.id,
        archivedAt: null,
        isAvailable: true,
        id: { not: dishId },
        category: { isActive: true },
      },
      include: { category: { select: { name: true } } },
      orderBy: [{ isFeatured: 'desc' }, { position: 'asc' }],
      take: 60,
    });
    for (const other of others) {
      const course = classifyCategory(other.category?.name ?? '');
      const weight = wanted[course];
      if (weight === undefined) continue;
      offer({
        dishId: other.id,
        score: weight,
        reason: PairingReason.COMPLEMENTARY_COURSE,
        blurb: null,
      });
    }
  }

  if (candidates.size === 0) return [];

  // --- hidratacion y filtro de dieta -------------------------------------
  const sourceDiets = new Set(source.dietTags.map((t) => t.tag as DietTag));
  const mustKeep = STRICT_DIETS.filter((d) => sourceDiets.has(d));

  const dishes = await prisma.dish.findMany({
    where: {
      id: { in: [...candidates.keys()] },
      tenantId: tenant.id,
      archivedAt: null,
      isAvailable: true,
    },
    include: dishInclude,
  });

  const ranked = dishes
    .map((dish) => ({ dish, candidate: candidates.get(dish.id)! }))
    .filter(({ dish }) => {
      if (mustKeep.length === 0) return true;
      const tags = new Set(dish.dietTags.map((t) => t.tag));
      return mustKeep.every((d) => tags.has(d));
    })
    .sort((a, b) => b.candidate.score - a.candidate.score)
    .slice(0, limit);

  const sourceLocale = tenant.defaultLocale as Locale;

  return Promise.all(
    ranked.map(async ({ dish, candidate }) => {
      let blurb = candidate.blurb;
      // El copy generado se pide solo si no hay uno curado y el plan lo incluye.
      if (!blurb && options.withAiCopy) {
        blurb = await writePairingBlurb({
          dishName: source.name,
          suggestionName: dish.name,
          suggestionCategory: dish.category?.name ?? '',
          locale: options.locale,
        });
      }
      return {
        dish: toDishDto(dish, {
          currency: tenant.currency,
          locale: options.locale,
          sourceLocale,
        }),
        reason: candidate.reason,
        score: Math.round(Math.min(candidate.score, 1) * 100) / 100,
        blurb,
      } satisfies PairingDto;
    }),
  );
}

/**
 * Cuenta en cuantos pedidos que incluyeron `dishId` aparecio cada otro plato.
 * Con volumenes grandes esto se precalcula en una tabla agregada por noche; a
 * escala de un restaurante, la consulta directa alcanza de sobra.
 */
async function loadCoOccurrence(
  tenantId: string,
  dishId: string,
): Promise<Map<string, { together: number; total: number }>> {
  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ['PAID', 'IN_KITCHEN', 'READY', 'SERVED'] },
      items: { some: { dishId } },
    },
    select: { items: { select: { dishId: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const total = orders.length;
  const counts = new Map<string, { together: number; total: number }>();
  for (const order of orders) {
    const seen = new Set<string>();
    for (const item of order.items) {
      if (item.dishId === dishId || seen.has(item.dishId)) continue;
      seen.add(item.dishId);
      const entry = counts.get(item.dishId) ?? { together: 0, total };
      entry.together += 1;
      counts.set(item.dishId, entry);
    }
  }
  return counts;
}

export { classifyCategory };
