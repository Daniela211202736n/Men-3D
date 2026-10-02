/**
 * Buscar un pedido por su codigo.
 *
 * El codigo es de cuatro caracteres sobre un alfabeto de 32 —poco mas de un
 * millon de combinaciones— y la ruta es publica. Con unos miles de pedidos en
 * la base, una de cada pocos cientos de pruebas acierta: probando codigos al
 * azar se leian el nombre y las aclaraciones de otros comensales.
 *
 * El codigo es corto a proposito: se canta en voz alta en el mostrador. Asi que
 * lo que cambia no es su largo sino lo que se entrega con el.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const SUFFIX = Date.now();
const SLUG = `pedido-${SUFFIX}`;
const GUEST = 'g-' + 'abcdef0123456789abcdef01'.slice(0, 24);
const CODE = 'AB2C';

let app: FastifyInstance;
let tenantId: string;

before(async () => {
  app = await buildApp();
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Pedido', defaultLocale: 'es', currency: 'ARS' },
  });
  tenantId = tenant.id;
  const cat = await prisma.category.create({ data: { tenantId, name: 'U', position: 0 } });
  const plato = await prisma.dish.create({
    data: { tenantId, categoryId: cat.id, name: 'Milanesa', priceCents: 100_000 },
  });

  await prisma.order.create({
    data: {
      tenantId,
      code: CODE,
      status: 'PAID',
      guestId: GUEST,
      customerName: 'Ana Gonzalez',
      notes: 'Sin sal, soy hipertensa',
      subtotalCents: 100_000,
      totalCents: 121_000,
      taxCents: 21_000,
      items: {
        create: [{ dishId: plato.id, nameSnapshot: 'Milanesa', quantity: 1, unitPriceCents: 100_000 }],
      },
    },
  });
});

after(async () => {
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

const pedir = (query: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/public/${SLUG}/orders/${CODE}`, query });

describe('con el codigo solo', () => {
  it('deja seguir el pedido', async () => {
    // Lo que el comensal necesita para saber como va, y el mostrador para
    // buscarlo, sigue estando.
    const r = await pedir();
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.code, CODE);
    assert.equal(body.status, 'PAID');
    assert.equal(body.totalCents, 121_000);
    assert.equal(body.items.length, 1);
  });

  it('NO entrega el nombre ni las aclaraciones', async () => {
    // Es lo que se filtraba probando codigos al azar. Las aclaraciones son lo
    // peor: ahi la gente escribe sus alergias.
    const body = (await pedir()).json();
    assert.equal(body.customerName, null, 'se filtro el nombre del comensal');
    assert.equal(body.notes, null, 'se filtraron las aclaraciones del pedido');
  });

  it('un guestId ajeno tampoco alcanza', async () => {
    const body = (await pedir({ guestId: 'g-000000000000000000000000' })).json();
    assert.equal(body.customerName, null);
    assert.equal(body.notes, null);
  });
});

describe('con el guestId del que lo hizo', () => {
  it('si entrega sus propios datos', async () => {
    // El comensal tiene que poder ver lo suyo; es su pedido.
    const body = (await pedir({ guestId: GUEST })).json();
    assert.equal(body.customerName, 'Ana Gonzalez');
    assert.equal(body.notes, 'Sin sal, soy hipertensa');
  });
});

describe('enumerar sale caro', () => {
  it('la ruta tiene un limite propio', async () => {
    // Con el limite general —300 por minuto— un restaurante con unos miles de
    // pedidos filtraria cientos por dia. Este limite lo hace no rendir.
    let bloqueado = false;
    for (let i = 0; i < 40; i += 1) {
      const r = await app.inject({
        method: 'GET',
        url: `/api/public/${SLUG}/orders/ZZ9Z`,
      });
      if (r.statusCode === 429) {
        bloqueado = true;
        break;
      }
    }
    assert.ok(bloqueado, 'se pudieron probar 40 codigos sin que nada frenara');
  });
});
