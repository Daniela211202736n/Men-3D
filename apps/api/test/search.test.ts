/**
 * Busqueda de la carta.
 *
 * El caso que importa es el que el demo escondia: los datos de ejemplo estaban
 * escritos sin tildes, asi que la busqueda parecia andar. Un restaurante real
 * carga "Café cortado" y el comensal escribe "cafe" desde el teclado del
 * celular —sin tilde, que es como escribe casi todo el mundo— y no encuentra
 * nada. El restaurante nunca se entera de por que ese plato no se pide.
 *
 * Se prueba contra la base real porque la normalizacion la hace PostgreSQL con
 * `unaccent`: un doble no probaria nada.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const SUFFIX = Date.now();
const SLUG = `busqueda-${SUFFIX}`;

let app: FastifyInstance;

/** Nombres buscables del restaurante de prueba. */
async function buscar(q: string): Promise<string[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/public/${SLUG}/menu`,
    query: { q },
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json().dishes as Array<{ name: string }>).map((d) => d.name);
}

before(async () => {
  app = await buildApp();

  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Busqueda', defaultLocale: 'es' },
  });
  const category = await prisma.category.create({
    data: { tenantId: tenant.id, name: 'Todo', position: 0 },
  });

  const platos = [
    {
      name: 'Café cortado',
      description: 'Espresso con un toque de leche.',
      ingredientes: ['Café', 'Leche'],
    },
    {
      name: 'Ñoquis del 29',
      description: 'Con salsa de tomate y albahaca.',
      ingredientes: ['Papa', 'Harina'],
    },
    {
      name: 'Milanesa napolitana',
      description: 'Con jamón, queso y salsa.',
      ingredientes: ['Ternera', 'Jamón crudo'],
    },
    {
      name: 'Descuento del 100% en el postre',
      description: 'Promocion de prueba con un comodin de LIKE en el nombre.',
      ingredientes: [],
    },
  ];

  for (const [i, plato] of platos.entries()) {
    await prisma.dish.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        name: plato.name,
        description: plato.description,
        priceCents: 100_000,
        position: i,
        ingredients: {
          create: plato.ingredientes.map((name) => ({ name })),
        },
      },
    });
  }

  // Una traduccion, para comprobar que tambien se busca ahi.
  const mila = await prisma.dish.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'Milanesa napolitana' },
  });
  await prisma.dishTranslation.create({
    data: {
      dishId: mila.id,
      locale: 'en',
      name: 'Breaded veal cutlet',
      description: 'With ham and cheese.',
      source: 'MANUAL',
    },
  });
});

after(async () => {
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

describe('busqueda de la carta', () => {
  it('sin tilde encuentra lo escrito con tilde', async () => {
    // El caso que motivo todo: asi escribe el comensal en el celular.
    assert.deepEqual(await buscar('cafe'), ['Café cortado']);
  });

  it('con tilde encuentra lo escrito con tilde', async () => {
    assert.deepEqual(await buscar('café'), ['Café cortado']);
  });

  it('ignora mayusculas y tildes a la vez', async () => {
    assert.deepEqual(await buscar('CAFÉ'), ['Café cortado']);
    assert.deepEqual(await buscar('CAFE'), ['Café cortado']);
  });

  it('la ñ se escribe con n', async () => {
    // Nadie busca la ñ en el teclado del telefono.
    assert.deepEqual(await buscar('noquis'), ['Ñoquis del 29']);
    assert.deepEqual(await buscar('ñoquis'), ['Ñoquis del 29']);
  });

  it('busca tambien en la descripcion y en los ingredientes', async () => {
    // "jamón" esta en la descripcion y en un ingrediente; una sola vez en la
    // respuesta, no dos: el SQL hace DISTINCT.
    assert.deepEqual(await buscar('jamon'), ['Milanesa napolitana']);
    assert.deepEqual(await buscar('ternera'), ['Milanesa napolitana']);
  });

  it('busca en las traducciones', async () => {
    // Un comensal con el telefono en ingles escribe en ingles.
    assert.deepEqual(await buscar('breaded'), ['Milanesa napolitana']);
  });

  it('los comodines de LIKE son texto, no patrones', async () => {
    // Sin escapar, '%' traeria la carta entera y '_' cualquier letra.
    assert.deepEqual(await buscar('100%'), ['Descuento del 100% en el postre']);
    assert.deepEqual(await buscar('%'), ['Descuento del 100% en el postre']);
    assert.deepEqual(await buscar('_'), []);
  });

  it('lo que no esta no aparece', async () => {
    assert.deepEqual(await buscar('sushi'), []);
  });
});
