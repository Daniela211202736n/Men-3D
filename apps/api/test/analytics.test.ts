/**
 * Agregacion de la analitica.
 *
 * Existe porque el informe paso de contar los eventos en Node a agregarlos en
 * la base, y ese es el tipo de cambio que puede salir mal sin que nada falle:
 * la pantalla sigue mostrando numeros, pero equivocados.
 *
 * Se siembran eventos conocidos y se comprueba cada numero contra lo que se
 * sembro, no contra lo que devuelve el codigo.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { getDashboard } from '../src/modules/analytics/service.js';

const SUFFIX = Date.now();
const SLUG = `analitica-${SUFFIX}`;

let tenantId: string;
let platoA: string;
let platoB: string;

/** Un evento de hace `diasAtras` dias. */
function evento(
  type: string,
  opciones: { dishId?: string; sessionId: string; durationMs?: number; query?: string; value?: number; diasAtras?: number },
) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() - (opciones.diasAtras ?? 0));
  fecha.setUTCHours(12, 0, 0, 0);
  return {
    tenantId,
    type,
    sessionId: opciones.sessionId,
    dishId: opciones.dishId ?? null,
    durationMs: opciones.durationMs ?? null,
    query: opciones.query ?? null,
    value: opciones.value ?? null,
    createdAt: fecha,
  };
}

before(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Analitica', defaultLocale: 'es', currency: 'ARS' },
  });
  tenantId = tenant.id;
  const cat = await prisma.category.create({ data: { tenantId, name: 'Unica', position: 0 } });
  platoA = (await prisma.dish.create({
    data: { tenantId, categoryId: cat.id, name: 'Plato A', priceCents: 100_000 },
  })).id;
  platoB = (await prisma.dish.create({
    data: { tenantId, categoryId: cat.id, name: 'Plato B', priceCents: 200_000 },
  })).id;

  await prisma.analyticsEvent.createMany({
    data: [
      // Sesion 1: mira la carta, abre A, lo ve en 3D dos veces, lo agrega.
      evento('MENU_OPEN', { sessionId: 's1' }),
      evento('DISH_OPEN', { sessionId: 's1', dishId: platoA }),
      evento('DISH_VIEW_3D', { sessionId: 's1', dishId: platoA, durationMs: 4000 }),
      evento('DISH_VIEW_3D', { sessionId: 's1', dishId: platoA, durationMs: 6000 }),
      evento('DISH_ROTATE', { sessionId: 's1', dishId: platoA }),
      evento('ADD_TO_CART', { sessionId: 's1', dishId: platoA }),
      // Sesion 2: mira la carta y se va. Es la que hace que el embudo no de 100%.
      evento('MENU_OPEN', { sessionId: 's2' }),
      // Sesion 3: busca dos veces, una sin resultados.
      evento('MENU_OPEN', { sessionId: 's3' }),
      evento('SEARCH', { sessionId: 's3', query: 'Milanesa', value: 3 }),
      evento('SEARCH', { sessionId: 's3', query: 'sushi', value: 0 }),
      evento('SEARCH', { sessionId: 's3', query: ' MILANESA ', value: 3 }),
      // Plato B: mirado en RA, nunca agregado.
      evento('DISH_VIEW_3D', { sessionId: 's3', dishId: platoB, durationMs: 2000 }),
      evento('AR_LAUNCH', { sessionId: 's3', dishId: platoB }),
      // Fuera del rango de 7 dias: no tiene que contar.
      evento('MENU_OPEN', { sessionId: 'viejo', diasAtras: 20 }),
      evento('DISH_VIEW_3D', { sessionId: 'viejo', dishId: platoA, diasAtras: 20 }),
    ],
  });
});

after(async () => {
  await deleteTenantsBySlug([SLUG]);
  await prisma.$disconnect();
});

describe('totales', () => {
  it('cuenta eventos y sesiones unicas del rango', async () => {
    const d = await getDashboard(tenantId, 'ARS', 7);
    assert.equal(d.totals.menuOpens, 3, 'tres aperturas dentro del rango');
    assert.equal(d.totals.uniqueSessions, 3, 's1, s2 y s3; la vieja queda afuera');
    assert.equal(d.totals.views3d, 3);
    assert.equal(d.totals.arLaunches, 1);
    assert.equal(d.totals.addToCarts, 1);
  });

  it('lo viejo entra cuando se amplia el rango', async () => {
    const d = await getDashboard(tenantId, 'ARS', 30);
    assert.equal(d.totals.menuOpens, 4);
    assert.equal(d.totals.uniqueSessions, 4);
  });
});

describe('plato por plato', () => {
  it('suma lo de cada uno por separado', async () => {
    const d = await getDashboard(tenantId, 'ARS', 7);
    const a = d.topDishes.find((x) => x.dishId === platoA);
    const b = d.topDishes.find((x) => x.dishId === platoB);

    assert.ok(a && b, 'faltan platos en el informe');
    assert.equal(a.views3d, 2);
    assert.equal(a.rotations, 1);
    assert.equal(a.addToCarts, 1);
    assert.equal(a.arLaunches, 0);
    // (4000 + 6000) / 2 = 5000 ms = 5 s
    assert.equal(a.avgViewSeconds, 5);

    assert.equal(b.views3d, 1);
    assert.equal(b.arLaunches, 1);
    assert.equal(b.addToCarts, 0);
  });
});

describe('embudo', () => {
  it('cuenta sesiones, no eventos', async () => {
    // Es la diferencia que importa: s1 vio el plato en 3D dos veces, pero en
    // el embudo es una sola sesion. Contar eventos daria un embudo que crece.
    const d = await getDashboard(tenantId, 'ARS', 7);
    const etapa = (n: string) => d.funnel.find((f) => f.stage === n)?.sessions;

    assert.equal(etapa('MENU_OPEN'), 3);
    assert.equal(etapa('DISH_OPEN'), 1);
    assert.equal(etapa('DISH_VIEW_3D'), 2, 's1 y s3, aunque s1 haya mirado dos veces');
    assert.equal(etapa('ADD_TO_CART'), 1);
  });
});

describe('busquedas', () => {
  it('agrupa sin distinguir mayusculas ni espacios', async () => {
    const d = await getDashboard(tenantId, 'ARS', 7);
    const milanesa = d.topSearches.find((s) => s.term === 'milanesa');
    assert.ok(milanesa, '"Milanesa" y " MILANESA " tienen que ser el mismo termino');
    assert.equal(milanesa.searches, 2);
    assert.equal(milanesa.zeroResults, 0);
  });

  it('marca las que no encontraron nada', async () => {
    // Es la lista de platos que faltan o estan mal nombrados.
    const d = await getDashboard(tenantId, 'ARS', 7);
    const sushi = d.topSearches.find((s) => s.term === 'sushi');
    assert.ok(sushi);
    assert.equal(sushi.zeroResults, 1);
  });

  it('el orden es estable entre consultas', async () => {
    // Sin desempate, dos terminos con el mismo conteo salen en distinto orden
    // cada vez y el tablero parece parpadear con datos que no cambiaron.
    const a = await getDashboard(tenantId, 'ARS', 7);
    const b = await getDashboard(tenantId, 'ARS', 7);
    assert.deepEqual(
      a.topSearches.map((s) => s.term),
      b.topSearches.map((s) => s.term),
    );
  });
});

describe('serie diaria', () => {
  it('tiene un punto por dia del rango', async () => {
    const d = await getDashboard(tenantId, 'ARS', 7);
    assert.equal(d.timeseries.length, 7);
    const conVistas = d.timeseries.filter((p) => p.views3d > 0);
    assert.equal(conVistas.length, 1, 'todas las vistas son de hoy');
    assert.equal(conVistas[0]!.views3d, 3);
  });
});
