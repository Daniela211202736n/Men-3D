/**
 * Datos de demostracion.
 *
 * Deja la plataforma lista para recorrer entera: dos restaurantes (uno con plan
 * PRO y carta completa en 3D, otro con plan STARTER para ver el feature
 * gating), reseñas, pedidos historicos y ~3 semanas de eventos de analitica,
 * para que el panel de metricas y el recomendador tengan de donde sacar señal.
 *
 * Es idempotente: se puede correr varias veces (borra los datos de los dos
 * tenants de demo y los vuelve a crear). No toca ningun otro tenant.
 */
import {
  AnalyticsEvent,
  LOYALTY_POINTS,
  PLAN_FEATURES,
  type Allergen,
  type DietTag,
} from '@men3d/shared';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { generateOrderCode, generateQrToken } from '../src/lib/ids.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const prisma = new PrismaClient();

const DEMO_SLUGS = ['la-parrilla-de-don-pepe', 'verde-bowl'];
/** Contraseña unica para todas las cuentas de demo. */
const DEMO_PASSWORD = 'men3d-demo-2026';

interface SeedDish {
  name: string;
  description: string;
  priceCents: number;
  model?: string;
  portionGrams?: number;
  calories?: number;
  prepMinutes?: number;
  allergens?: Allergen[];
  dietTags?: DietTag[];
  ingredients?: string[];
  isFeatured?: boolean;
  compareAtPriceCents?: number;
}

interface SeedCategory {
  name: string;
  description: string;
  dishes: SeedDish[];
}

const PARRILLA_MENU: SeedCategory[] = [
  {
    name: 'Entradas',
    description: 'Para empezar y compartir',
    dishes: [
      {
        name: 'Provoleta a la parrilla',
        description:
          'Rueda de provolone dorada en sartén de hierro, con oregano y aceite de oliva.',
        priceCents: 780000,
        model: 'provoleta-a-la-parrilla',
        portionGrams: 180,
        calories: 420,
        prepMinutes: 10,
        allergens: ['MILK'],
        dietTags: ['VEGETARIAN', 'GLUTEN_FREE', 'KETO'],
        ingredients: ['Provolone', 'Orégano', 'Aceite de oliva'],
        isFeatured: true,
      },
      {
        name: 'Empanadas de carne (3 unidades)',
        description:
          'Masa casera, carne cortada a cuchillo, huevo y aceituna. Al horno de barro.',
        priceCents: 690000,
        model: 'empanadas-carne',
        portionGrams: 240,
        calories: 540,
        prepMinutes: 12,
        allergens: ['GLUTEN', 'EGGS'],
        ingredients: ['Harina', 'Carne', 'Huevo', 'Aceituna', 'Cebolla'],
      },
    ],
  },
  {
    name: 'Platos principales',
    description: 'De la parrilla y de la cocina',
    dishes: [
      {
        name: 'Milanesa napolitana con papas',
        description:
          'Milanesa de ternera de 220 g, salsa de tomate, jamón y mozzarella gratinada. Con papas bastón.',
        priceCents: 1450000,
        compareAtPriceCents: 1680000,
        model: 'milanesa-napolitana',
        portionGrams: 520,
        calories: 1120,
        prepMinutes: 18,
        allergens: ['GLUTEN', 'EGGS', 'MILK'],
        ingredients: [
          'Ternera', 'Pan rallado', 'Huevo', 'Tomate', 'Jamón', 'Mozzarella', 'Papas',
        ],
        isFeatured: true,
      },
      {
        name: 'Hamburguesa clasica doble',
        description:
          'Dos medallones de 120 g, cheddar, lechuga, tomate y pan de papa. Con papas.',
        priceCents: 1280000,
        model: 'hamburguesa-clasica',
        portionGrams: 480,
        calories: 980,
        prepMinutes: 15,
        allergens: ['GLUTEN', 'MILK', 'SESAME'],
        ingredients: ['Carne', 'Cheddar', 'Lechuga', 'Tomate', 'Pan de papa'],
      },
    ],
  },
  {
    name: 'Postres',
    description: 'El final feliz',
    dishes: [
      {
        name: 'Flan casero con crema',
        description: 'Flan de huevo con caramelo y un copo de crema batida.',
        priceCents: 520000,
        model: 'flan-casero',
        portionGrams: 180,
        calories: 380,
        prepMinutes: 5,
        allergens: ['EGGS', 'MILK'],
        dietTags: ['VEGETARIAN', 'GLUTEN_FREE'],
        ingredients: ['Huevo', 'Leche', 'Azúcar', 'Crema'],
      },
    ],
  },
  {
    name: 'Bebidas',
    description: 'Vinos, cafe y algo fresco',
    dishes: [
      {
        name: 'Copa de Malbec',
        description: 'Malbec de Valle de Uco, cosecha 2022. Copa de 150 ml.',
        priceCents: 650000,
        model: 'malbec-copa',
        portionGrams: 150,
        calories: 125,
        prepMinutes: 2,
        allergens: ['SULPHITES'],
        dietTags: ['VEGAN', 'GLUTEN_FREE'],
        ingredients: ['Malbec'],
        isFeatured: true,
      },
      {
        name: 'Café cortado',
        description: 'Espresso doble con leche texturada.',
        priceCents: 280000,
        model: 'cafe-cortado',
        portionGrams: 90,
        calories: 60,
        prepMinutes: 3,
        allergens: ['MILK'],
        dietTags: ['VEGETARIAN', 'GLUTEN_FREE'],
        ingredients: ['Café', 'Leche'],
      },
    ],
  },
];

const VERDE_MENU: SeedCategory[] = [
  {
    name: 'Bowls',
    description: 'Base de hojas verdes, armado a tu gusto',
    dishes: [
      {
        name: 'Ensalada mediterranea',
        description:
          'Mix de hojas, tomates cherry, queso feta, aceitunas y aderezo de limón.',
        priceCents: 890000,
        model: 'ensalada-mediterranea',
        portionGrams: 350,
        calories: 420,
        prepMinutes: 8,
        allergens: ['MILK'],
        dietTags: ['VEGETARIAN', 'GLUTEN_FREE', 'KETO'],
        ingredients: ['Hojas verdes', 'Tomate cherry', 'Feta', 'Aceitunas', 'Limón'],
        isFeatured: true,
      },
    ],
  },
  {
    name: 'Bebidas frias',
    description: 'Sin azúcar agregada',
    dishes: [
      {
        name: 'Limonada con jengibre',
        description: 'Limón, jengibre fresco y menta. Sin azúcar agregada.',
        priceCents: 420000,
        portionGrams: 400,
        calories: 45,
        prepMinutes: 4,
        dietTags: ['VEGAN', 'GLUTEN_FREE', 'LACTOSE_FREE'],
        ingredients: ['Limón', 'Jengibre', 'Menta'],
      },
    ],
  },
];

async function seedPlans() {
  const plans = [
    {
      tier: 'FREE',
      name: 'Prueba',
      monthlyCents: 0,
      setupFeeCents: 0,
      maxDishes: 15,
      max3dModels: 3,
    },
    {
      tier: 'STARTER',
      name: 'Starter',
      monthlyCents: 2900000,
      setupFeeCents: 9900000,
      maxDishes: 60,
      max3dModels: 15,
    },
    {
      tier: 'PRO',
      name: 'Pro',
      monthlyCents: 5900000,
      setupFeeCents: 19900000,
      maxDishes: 0,
      max3dModels: 60,
    },
    {
      tier: 'ENTERPRISE',
      name: 'Enterprise',
      monthlyCents: 14900000,
      setupFeeCents: 49900000,
      maxDishes: 0,
      max3dModels: 0,
    },
  ] as const;

  for (const plan of plans) {
    const features = [...(PLAN_FEATURES[plan.tier] ?? [])].join(',');
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      create: { ...plan, features },
      update: { ...plan, features },
    });
  }
  console.log(`  planes: ${plans.length}`);
}

async function wipeDemoTenants() {
  // Pasa por el borrado en orden de dependencias: la cascada sola choca contra
  // las restricciones que protegen el historico de ventas (ver
  // modules/tenants/service.ts).
  const count = await deleteTenantsBySlug([...DEMO_SLUGS]);
  if (count > 0) console.log(`  tenants de demo anteriores borrados: ${count}`);
}

interface SeedTenantInput {
  slug: string;
  name: string;
  description: string;
  tier: 'STARTER' | 'PRO';
  menu: SeedCategory[];
  ownerEmail: string;
  ownerName: string;
  branding: { primaryColor: string; accentColor: string; colorScheme: string };
  location: { addressLine: string; city: string; country: string; lat: number; lng: number };
  social: { instagramUrl?: string; tiktokUrl?: string };
  whatsapp: string;
  enabledLocales: string;
  tables: string[];
}

async function seedTenant(input: SeedTenantInput) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: input.tier } });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const tenant = await prisma.tenant.create({
    data: {
      slug: input.slug,
      name: input.name,
      description: input.description,
      phone: '+54 11 4000-0000',
      whatsapp: input.whatsapp,
      email: input.ownerEmail,
      addressLine: input.location.addressLine,
      city: input.location.city,
      country: input.location.country,
      latitude: input.location.lat,
      longitude: input.location.lng,
      instagramUrl: input.social.instagramUrl ?? null,
      tiktokUrl: input.social.tiktokUrl ?? null,
      openingHours: 'Mar a Dom 12:00–15:30 y 20:00–00:00',
      currency: 'ARS',
      defaultLocale: 'es',
      enabledLocales: input.enabledLocales,
      taxRateBps: 2100,
      serviceModes: 'DINE_IN,TAKEAWAY',
      branding: { create: input.branding },
      subscription: {
        create: {
          planId: plan.id,
          status: 'ACTIVE',
          setupFeePaid: true,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
      users: {
        create: [
          {
            email: input.ownerEmail,
            name: input.ownerName,
            passwordHash,
            role: 'OWNER',
          },
          {
            email: `cocina@${input.slug}.demo`,
            name: 'Pantalla de cocina',
            passwordHash,
            role: 'STAFF',
          },
        ],
      },
      qrCodes: {
        create: input.tables.map((tableLabel) => ({
          tableLabel,
          token: generateQrToken(),
          scans: Math.floor(Math.random() * 40) + 5,
          lastScanAt: new Date(Date.now() - Math.random() * 3 * 24 * 3600 * 1000),
        })),
      },
    },
  });

  const dishIdByName = new Map<string, string>();

  for (const [categoryIndex, category] of input.menu.entries()) {
    const createdCategory = await prisma.category.create({
      data: {
        tenantId: tenant.id,
        name: category.name,
        description: category.description,
        position: categoryIndex,
      },
    });

    for (const [dishIndex, dish] of category.dishes.entries()) {
      const created = await prisma.dish.create({
        data: {
          tenantId: tenant.id,
          categoryId: createdCategory.id,
          name: dish.name,
          description: dish.description,
          priceCents: dish.priceCents,
          compareAtPriceCents: dish.compareAtPriceCents ?? null,
          // Los GLB los genera scripts/generate-sample-models.mjs y los sirve
          // la PWA desde /models (en produccion: un CDN).
          modelGlbUrl: dish.model ? `/models/${dish.model}.glb` : null,
          portionGrams: dish.portionGrams ?? null,
          calories: dish.calories ?? null,
          prepMinutes: dish.prepMinutes ?? null,
          isFeatured: dish.isFeatured ?? false,
          position: categoryIndex * 10 + dishIndex,
          allergens: {
            create: (dish.allergens ?? []).map((allergen) => ({ allergen })),
          },
          dietTags: { create: (dish.dietTags ?? []).map((tag) => ({ tag })) },
          ingredients: {
            create: (dish.ingredients ?? []).map((name, position) => ({
              name,
              position,
            })),
          },
        },
      });
      dishIdByName.set(dish.name, created.id);
    }
  }

  return { tenant, dishIdByName };
}

/** Maridajes curados: el dueño eligio estas combinaciones a mano. */
async function seedPairings(
  tenantId: string,
  dishIds: Map<string, string>,
  pairs: Array<[string, string, number, string]>,
) {
  for (const [from, to, weight, blurb] of pairs) {
    const dishId = dishIds.get(from);
    const suggestedDishId = dishIds.get(to);
    if (!dishId || !suggestedDishId) continue;
    await prisma.pairing.create({
      data: { tenantId, dishId, suggestedDishId, reason: 'CURATED', weight, blurb },
    });
  }
}

async function seedReviews(tenantId: string, dishIds: Map<string, string>) {
  const dishReviews: Array<[string, number, string, string]> = [
    ['Milanesa napolitana con papas', 5, 'Enorme y bien gratinada. La porción que se ve en 3D es exacta.', 'Sofía R.'],
    ['Milanesa napolitana con papas', 4, 'Muy rica, las papas podrían venir más crocantes.', 'Martín L.'],
    ['Milanesa napolitana con papas', 5, 'Alcanza para dos. Pedimos una y media y sobró.', 'Caro'],
    ['Provoleta a la parrilla', 5, 'Justo en el punto, llega burbujeando a la mesa.', 'Diego F.'],
    ['Provoleta a la parrilla', 4, 'Muy buena, un poco salada para mi gusto.', 'Ana'],
    ['Hamburguesa clasica doble', 4, 'Jugosa. El pan aguanta bien hasta el final.', 'Nico'],
    ['Copa de Malbec', 5, 'Buena relacion precio-calidad, lo recomiendan bien.', 'Valeria'],
    ['Empanadas de carne (3 unidades)', 5, 'Carne cortada a cuchillo de verdad.', 'Jorge M.'],
    ['Flan casero con crema', 4, 'Clasico bien hecho.', 'Lu'],
    ['Ensalada mediterranea', 5, 'Fresca y abundante, el feta es de primera.', 'Pau'],
  ];

  for (const [dishName, rating, comment, authorName] of dishReviews) {
    const dishId = dishIds.get(dishName);
    if (!dishId) continue;
    await prisma.review.create({
      data: {
        tenantId,
        dishId,
        rating,
        comment,
        authorName,
        status: 'PUBLISHED',
        createdAt: new Date(Date.now() - Math.random() * 20 * 24 * 3600 * 1000),
      },
    });
  }

  // Reseñas generales del local.
  for (const [rating, comment, authorName] of [
    [5, 'Atencion impecable y el menu en 3D es un golazo: sabes exactamente que pedis.', 'Familia Gomez'],
    [4, 'Muy buena comida. Un poco de espera un sabado a la noche, pero valio la pena.', 'Hernan'],
    [5, 'Volvimos tres veces en el mes. El QR de la mesa funciona perfecto.', 'Rocio'],
  ] as const) {
    await prisma.review.create({
      data: { tenantId, rating, comment, authorName, status: 'PUBLISHED' },
    });
  }

  // Una reseña pendiente de moderar, para que el backoffice tenga algo que hacer.
  await prisma.review.create({
    data: {
      tenantId,
      rating: 2,
      comment: 'Tardaron mucho en traer la cuenta.',
      authorName: 'Anonimo',
      status: 'PENDING',
    },
  });
}

/**
 * Pedidos historicos y eventos de analitica correlacionados.
 *
 * Los eventos no son ruido aleatorio: se generan con la forma de un embudo real
 * (muchos miran, menos giran el modelo, pocos compran) y la milanesa recibe
 * mucha vista con conversion media, mientras el flan se mira y casi no se pide
 * — justo el patron que el informe "interes visual vs ventas" debe delatar.
 */
async function seedTraffic(
  tenantId: string,
  dishIds: Map<string, string>,
  taxRateBps: number,
) {
  const entries = [...dishIds.entries()];
  if (entries.length === 0) return;

  /** Peso de atencion y de conversion por plato. */
  const profile = new Map<string, { attention: number; conversion: number }>([
    ['Milanesa napolitana con papas', { attention: 1.0, conversion: 0.34 }],
    ['Hamburguesa clasica doble', { attention: 0.72, conversion: 0.3 }],
    ['Provoleta a la parrilla', { attention: 0.6, conversion: 0.26 }],
    ['Empanadas de carne (3 unidades)', { attention: 0.45, conversion: 0.28 }],
    ['Copa de Malbec', { attention: 0.3, conversion: 0.4 }],
    // El caso interesante: lo miran mucho y casi nadie lo pide.
    ['Flan casero con crema', { attention: 0.65, conversion: 0.06 }],
    ['Café cortado', { attention: 0.2, conversion: 0.35 }],
    ['Ensalada mediterranea', { attention: 0.9, conversion: 0.3 }],
    ['Limonada con jengibre', { attention: 0.4, conversion: 0.35 }],
  ]);

  const events: Array<{
    tenantId: string;
    type: string;
    dishId: string | null;
    sessionId: string;
    durationMs: number | null;
    query: string | null;
    value: number | null;
    locale: string;
    createdAt: Date;
  }> = [];

  const searchTerms = [
    ['milanesa', 6], ['milanesa', 6], ['provoleta', 2], ['vegano', 0],
    ['sin tacc', 0], ['burger', 1], ['postre', 1], ['hamburguesa', 1],
    ['vino', 2], ['celiaco', 0],
  ] as const;

  const DAYS = 21;
  let sessionCounter = 0;
  const orders: Array<{ at: Date; lines: Array<{ name: string; qty: number }>; table: string }> = [];

  for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    const dayStart = new Date();
    dayStart.setUTCHours(12, 0, 0, 0);
    dayStart.setUTCDate(dayStart.getUTCDate() - dayOffset);

    // Mas trafico los fines de semana.
    const weekday = dayStart.getUTCDay();
    const base = weekday === 5 || weekday === 6 ? 34 : 18;
    const sessions = base + Math.floor(Math.random() * 10);

    for (let s = 0; s < sessions; s += 1) {
      sessionCounter += 1;
      const sessionId = `seed-${tenantId.slice(-6)}-${sessionCounter}`;
      // Las visitas se reparten a lo largo del dia, pero nunca en el futuro: un
      // pedido con fecha posterior a ahora le mostraria minutos negativos a la
      // cocina y se colaria en la ventana de "servidos" del tablero.
      const at = (minutesLater: number) => {
        const when = dayStart.getTime() + (s * 7 + minutesLater) * 60_000;
        return new Date(Math.min(when, Date.now() - 60_000));
      };

      events.push({
        tenantId, type: AnalyticsEvent.MENU_OPEN, dishId: null, sessionId,
        durationMs: null, query: null, value: null, locale: 'es', createdAt: at(0),
      });

      // Una de cada cuatro sesiones busca algo.
      if (Math.random() < 0.25) {
        const [term, results] = searchTerms[Math.floor(Math.random() * searchTerms.length)]!;
        events.push({
          tenantId, type: AnalyticsEvent.SEARCH, dishId: null, sessionId,
          durationMs: null, query: term, value: results, locale: 'es', createdAt: at(1),
        });
      }

      // Abre entre 1 y 3 platos, ponderado por atencion.
      const opened = pickWeighted(entries, profile, 1 + Math.floor(Math.random() * 3));
      const cart: Array<{ name: string; qty: number }> = [];

      for (const [index, [dishName, dishId]] of opened.entries()) {
        const p = profile.get(dishName) ?? { attention: 0.4, conversion: 0.2 };
        const t = 2 + index * 2;

        events.push({
          tenantId, type: AnalyticsEvent.DISH_OPEN, dishId, sessionId,
          durationMs: null, query: null, value: null, locale: 'es', createdAt: at(t),
        });

        // ~70 % de las aperturas llegan al visor 3D.
        if (Math.random() < 0.7) {
          const seconds = 4 + Math.random() * 22 * p.attention;
          events.push({
            tenantId, type: AnalyticsEvent.DISH_VIEW_3D, dishId, sessionId,
            durationMs: Math.round(seconds * 1000), query: null, value: null,
            locale: 'es', createdAt: at(t),
          });
          // Girar el modelo: varios eventos por visita.
          const rotations = Math.floor(Math.random() * 6 * p.attention);
          for (let r = 0; r < rotations; r += 1) {
            events.push({
              tenantId, type: AnalyticsEvent.DISH_ROTATE, dishId, sessionId,
              durationMs: null, query: null, value: null, locale: 'es', createdAt: at(t),
            });
          }
          // Lanzar RA: minoria, pero es la funcion estrella.
          if (Math.random() < 0.18) {
            events.push({
              tenantId, type: AnalyticsEvent.AR_LAUNCH, dishId, sessionId,
              durationMs: null, query: null, value: null, locale: 'es', createdAt: at(t + 1),
            });
          }
        }

        if (Math.random() < p.conversion) {
          const qty = Math.random() < 0.15 ? 2 : 1;
          cart.push({ name: dishName, qty });
          events.push({
            tenantId, type: AnalyticsEvent.ADD_TO_CART, dishId, sessionId,
            durationMs: null, query: null, value: qty, locale: 'es', createdAt: at(t + 2),
          });
        }
      }

      // De los carritos armados, el 70 % termina en pedido.
      if (cart.length > 0 && Math.random() < 0.7) {
        events.push({
          tenantId, type: AnalyticsEvent.CHECKOUT_START, dishId: null, sessionId,
          durationMs: null, query: null, value: null, locale: 'es', createdAt: at(12),
        });
        events.push({
          tenantId, type: AnalyticsEvent.PURCHASE, dishId: null, sessionId,
          durationMs: null, query: null, value: null, locale: 'es', createdAt: at(13),
        });
        orders.push({
          at: at(13),
          lines: cart,
          table: String(1 + Math.floor(Math.random() * 8)),
        });
      }
    }
  }

  // Los eventos se insertan en lotes: SQLite tiene un limite de variables por
  // sentencia y un createMany gigante lo revienta.
  for (let i = 0; i < events.length; i += 500) {
    await prisma.analyticsEvent.createMany({ data: events.slice(i, i + 500) });
  }

  // Pedidos reales derivados de esos carritos.
  const dishRows = await prisma.dish.findMany({
    where: { tenantId },
    select: { id: true, name: true, priceCents: true },
  });
  const priceByName = new Map(dishRows.map((d) => [d.name, d]));

  const usedCodes = new Set<string>();
  for (const order of orders) {
    const lines = order.lines
      .map((line) => {
        const dish = priceByName.get(line.name);
        if (!dish) return null;
        return {
          dishId: dish.id,
          nameSnapshot: dish.name,
          unitPriceCents: dish.priceCents,
          quantity: line.qty,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    if (lines.length === 0) continue;

    const subtotalCents = lines.reduce(
      (acc, l) => acc + l.unitPriceCents * l.quantity,
      0,
    );
    const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
    const totalCents = subtotalCents + taxCents;

    let code = generateOrderCode();
    while (usedCodes.has(code)) code = generateOrderCode();
    usedCodes.add(code);

    const created = await prisma.order.create({
      data: {
        tenantId,
        code,
        status: 'SERVED',
        serviceMode: 'DINE_IN',
        tableLabel: order.table,
        subtotalCents,
        taxCents,
        totalCents,
        pointsEarned: Math.floor((totalCents / 100) * LOYALTY_POINTS.PER_CURRENCY_UNIT),
        createdAt: order.at,
        acceptedAt: new Date(order.at.getTime() + 2 * 60_000),
        readyAt: new Date(order.at.getTime() + 16 * 60_000),
        items: { create: lines },
      },
    });

    await prisma.payment.create({
      data: {
        orderId: created.id,
        provider: 'mock',
        providerRef: `seed_${created.code}`,
        status: 'SUCCEEDED',
        amountCents: totalCents,
        currency: 'ARS',
      },
    });
  }

  // Dos pedidos vivos para que el KDS no arranque vacio.
  const liveStatuses = ['PAID', 'IN_KITCHEN'] as const;
  for (const [index, status] of liveStatuses.entries()) {
    const dish = dishRows[index % dishRows.length]!;
    let code = generateOrderCode();
    while (usedCodes.has(code)) code = generateOrderCode();
    usedCodes.add(code);

    const subtotalCents = dish.priceCents;
    const taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
    await prisma.order.create({
      data: {
        tenantId,
        code,
        status,
        serviceMode: 'DINE_IN',
        tableLabel: String(index + 3),
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
        customerName: index === 0 ? 'Mesa 3' : 'Mesa 4',
        items: {
          create: [
            {
              dishId: dish.id,
              nameSnapshot: dish.name,
              unitPriceCents: dish.priceCents,
              quantity: 1,
            },
          ],
        },
      },
    });
  }

  console.log(
    `  trafico: ${events.length} eventos, ${orders.length} pedidos historicos`,
  );
}

/** Elige `count` platos distintos ponderando por atencion. */
function pickWeighted(
  entries: Array<[string, string]>,
  profile: Map<string, { attention: number; conversion: number }>,
  count: number,
): Array<[string, string]> {
  const pool = [...entries];
  const chosen: Array<[string, string]> = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const weights = pool.map(
      ([name]) => (profile.get(name)?.attention ?? 0.4) + 0.05,
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let index = 0;
    while (index < pool.length - 1 && roll > weights[index]!) {
      roll -= weights[index]!;
      index += 1;
    }
    chosen.push(pool.splice(index, 1)[0]!);
  }
  return chosen;
}

async function main() {
  console.log('Sembrando datos de demostracion...\n');

  await seedPlans();
  await wipeDemoTenants();

  const parrilla = await seedTenant({
    slug: 'la-parrilla-de-don-pepe',
    name: 'La Parrilla de Don Pepe',
    description:
      'Parrilla de barrio desde 1987. Carnes a la brasa, pastas caseras y la milanesa mas pedida de Palermo.',
    tier: 'PRO',
    menu: PARRILLA_MENU,
    ownerEmail: 'pepe@donpepe.demo',
    ownerName: 'Jose "Pepe" Martinez',
    branding: {
      primaryColor: '#b5341f',
      accentColor: '#eda100',
      colorScheme: 'system',
    },
    location: {
      addressLine: 'Av. Santa Fe 3253',
      city: 'Buenos Aires',
      country: 'Argentina',
      lat: -34.5889,
      lng: -58.4106,
    },
    social: {
      instagramUrl: 'https://instagram.com/parrilladonpepe',
      tiktokUrl: 'https://tiktok.com/@parrilladonpepe',
    },
    whatsapp: '+5491150000001',
    enabledLocales: 'es,en,pt',
    tables: ['1', '2', '3', '4', '5', '6', '7', '8', 'Barra'],
  });

  await seedPairings(parrilla.tenant.id, parrilla.dishIdByName, [
    ['Milanesa napolitana con papas', 'Copa de Malbec', 90,
      'El Malbec corta la grasa del gratinado y limpia el paladar.'],
    ['Milanesa napolitana con papas', 'Flan casero con crema', 70,
      'Un postre liviano despues de una porcion contundente.'],
    ['Provoleta a la parrilla', 'Copa de Malbec', 85,
      'Clasico infalible: queso fundido y tinto joven.'],
    ['Hamburguesa clasica doble', 'Café cortado', 50,
      'Un cortado corto para cerrar sin pesadez.'],
    ['Empanadas de carne (3 unidades)', 'Copa de Malbec', 80,
      'La combinacion de siempre, por algo no falla.'],
  ]);
  await seedReviews(parrilla.tenant.id, parrilla.dishIdByName);
  await seedTraffic(parrilla.tenant.id, parrilla.dishIdByName, 2100);
  console.log(`  tenant PRO: /m/${parrilla.tenant.slug}\n`);

  const verde = await seedTenant({
    slug: 'verde-bowl',
    name: 'Verde Bowl',
    description:
      'Cocina de estacion, basada en plantas. Todo se arma a la vista en el mostrador.',
    tier: 'STARTER',
    menu: VERDE_MENU,
    ownerEmail: 'hola@verdebowl.demo',
    ownerName: 'Lucia Ferrari',
    branding: {
      primaryColor: '#1baf7a',
      accentColor: '#4a3aa7',
      colorScheme: 'light',
    },
    location: {
      addressLine: 'Gorriti 4865',
      city: 'Buenos Aires',
      country: 'Argentina',
      lat: -34.5876,
      lng: -58.4312,
    },
    social: { instagramUrl: 'https://instagram.com/verdebowl' },
    whatsapp: '+5491150000002',
    enabledLocales: 'es,en',
    tables: ['1', '2', '3', '4'],
  });

  await seedPairings(verde.tenant.id, verde.dishIdByName, [
    ['Ensalada mediterranea', 'Limonada con jengibre', 80,
      'El jengibre refresca y acompaña sin tapar el feta.'],
  ]);
  await seedReviews(verde.tenant.id, verde.dishIdByName);
  await seedTraffic(verde.tenant.id, verde.dishIdByName, 2100);
  console.log(`  tenant STARTER: /m/${verde.tenant.slug}\n`);

  console.log('Listo. Cuentas del backoffice (contraseña para todas:');
  console.log(`"${DEMO_PASSWORD}"):`);
  console.log('  pepe@donpepe.demo        OWNER  — plan PRO (todo habilitado)');
  console.log('  cocina@la-parrilla-de-don-pepe.demo  STAFF — solo KDS');
  console.log('  hola@verdebowl.demo      OWNER  — plan STARTER (sin pedidos ni analitica)');
}

main()
  .catch((error) => {
    console.error('\nFallo el seed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
