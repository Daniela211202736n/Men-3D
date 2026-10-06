/**
 * Pruebas A/B de carta.
 *
 * Hay una prueba acá que vale mas que todas las demas juntas: **el comensal
 * paga el precio que vio**. Si la carta le muestra $5.900 porque le toco la
 * variante B y el pedido se liquida a $6.900 porque el cobro resolvio la
 * variante por otro camino, eso no es un experimento mal medido: es un cobro
 * indebido, en el producto de un cliente, contra un comensal que no tiene forma
 * de darse cuenta.
 *
 * Esa prueba recorre el camino completo —leer la carta, abrir el plato, pedir—
 * con el mismo `guestId`, y compara contra lo que quedo guardado en la linea
 * del pedido. Y lo hace para las DOS variantes, buscando dos dispositivos que
 * caigan en lados distintos: una prueba que solo mira la variante A pasaria
 * aunque B estuviera completamente roto.
 *
 * Lo demas: que la asignacion sea estable (si cambia al recargar, al comensal
 * le baila el precio en la cara), que sin `guestId` se sirva el control, que un
 * plato no pueda tener dos pruebas a la vez, y que el veredicto se niegue a
 * opinar cuando la muestra no alcanza.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import {
  pruebaDeProporciones,
  veredictoDe,
  type NumerosDeVariante,
} from '../src/modules/experiments/resultados.js';
import { varianteDe } from '../src/modules/experiments/service.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { prisma } from '../src/prisma.js';

const SUFFIX = Date.now();
const SLUG = `ab-${SUFFIX}`;
const EMAIL = `ab-${SUFFIX}@prueba.demo`;
const PASSWORD = 'prueba-ab-2026';

const PRECIO_A = 590000;
const PRECIO_B = 690000;

let app: FastifyInstance;
let tenantId: string;
let dishId: string;
let token: string;

before(async () => {
  app = await buildApp();

  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: 'PRO' } });
  const tenant = await prisma.tenant.create({
    data: {
      slug: SLUG,
      name: 'Pruebas A/B',
      defaultLocale: 'es',
      currency: 'ARS',
      branding: { create: {} },
      subscription: { create: { planId: plan.id, status: 'ACTIVE' } },
      users: {
        create: {
          email: EMAIL,
          name: 'Dueño',
          role: 'OWNER',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      },
      categories: { create: { name: 'Principales', position: 0 } },
    },
    include: { categories: true },
  });
  tenantId = tenant.id;

  const dish = await prisma.dish.create({
    data: {
      tenantId,
      categoryId: tenant.categories[0]!.id,
      name: 'Milanesa de prueba',
      description: 'La de siempre',
      priceCents: PRECIO_A,
      position: 0,
    },
  });
  dishId = dish.id;

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAIL, password: PASSWORD },
  });
  token = login.json().token as string;
});

after(async () => {
  await prisma.experiment.deleteMany({ where: { tenantId } });
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

async function comoAdmin(
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
): Promise<ReturnType<FastifyInstance['inject']> extends Promise<infer R> ? R : never> {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

/** El precio que la carta publica le muestra a este dispositivo. */
async function precioEnLaCarta(guestId?: string): Promise<number> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/public/${SLUG}/menu`,
    query: guestId ? { guestId } : {},
  });
  assert.equal(response.statusCode, 200, response.body);
  const menu = response.json() as {
    dishes: { id: string; priceCents: number }[];
  };
  const plato = menu.dishes.find((d) => d.id === dishId);
  assert.ok(plato, 'el plato no esta en la carta');
  return plato.priceCents;
}

/** El precio que la ficha del plato le muestra a este dispositivo. */
async function precioEnLaFicha(guestId?: string): Promise<number> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/public/${SLUG}/dishes/${dishId}`,
    query: guestId ? { guestId } : {},
  });
  assert.equal(response.statusCode, 200, response.body);
  return (response.json() as { priceCents: number }).priceCents;
}

/** Hace el pedido y devuelve lo que quedo guardado en la linea. */
async function precioCobrado(
  guestId?: string,
): Promise<{ unitPriceCents: number; variant: string | null }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/public/${SLUG}/orders`,
    payload: {
      items: [{ dishId, quantity: 1 }],
      serviceMode: 'DINE_IN',
      ...(guestId ? { guestId } : {}),
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const { order } = response.json() as { order: { id: string } };
  const linea = await prisma.orderItem.findFirstOrThrow({
    where: { orderId: order.id, dishId },
    select: { unitPriceCents: true, variant: true },
  });
  return linea;
}

/** Busca un dispositivo que caiga en la variante pedida. */
function guestIdEnVariante(experimentId: string, buscada: 'A' | 'B'): string {
  for (let i = 0; i < 200; i += 1) {
    const candidato = `g-${SUFFIX}${i.toString().padStart(6, '0')}`;
    if (varianteDe(candidato, experimentId) === buscada) return candidato;
  }
  throw new Error(`no encontre un guestId en la variante ${buscada}`);
}

describe('asignacion de variantes', () => {
  it('es estable: el mismo dispositivo ve siempre lo mismo', () => {
    // Si esto falla, al comensal le cambia el precio al recargar la pagina.
    const guestId = 'g-abcdef0123456789abcdef01';
    const primera = varianteDe(guestId, 'exp-1');
    for (let i = 0; i < 50; i += 1) {
      assert.equal(varianteDe(guestId, 'exp-1'), primera);
    }
  });

  it('reparte mas o menos por mitades', () => {
    let bes = 0;
    const total = 2000;
    for (let i = 0; i < total; i += 1) {
      if (varianteDe(`g-${i.toString().padStart(24, '0')}`, 'exp-reparto') === 'B') bes += 1;
    }
    // 45%-55% con 2000 tiradas: un reparto peor que eso delata un hash malo.
    assert.ok(bes > total * 0.45 && bes < total * 0.55, `${bes} de ${total} en B`);
  });

  it('un mismo dispositivo no cae siempre del mismo lado en pruebas distintas', () => {
    // Si el hash ignorara el id del experimento, esta mitad de la gente
    // arrastraria su sesgo a todas las pruebas del restaurante.
    const guestId = 'g-0f0f0f0f0f0f0f0f0f0f0f0f';
    const variantes = new Set(
      Array.from({ length: 20 }, (_, i) => varianteDe(guestId, `exp-${i}`)),
    );
    assert.equal(variantes.size, 2, 'cae siempre en la misma variante');
  });
});

describe('el comensal paga lo que vio', () => {
  let experimentId: string;

  before(async () => {
    const response = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'PRICE',
      valueB: String(PRECIO_B),
    });
    assert.equal(response.statusCode, 201, response.body);
    experimentId = (response.json() as { id: string }).id;
  });

  after(async () => {
    await prisma.experiment.deleteMany({ where: { id: experimentId } });
  });

  it('la variante A ve y paga el precio del plato', async () => {
    const guestId = guestIdEnVariante(experimentId, 'A');
    assert.equal(await precioEnLaCarta(guestId), PRECIO_A);
    assert.equal(await precioEnLaFicha(guestId), PRECIO_A);

    const cobrado = await precioCobrado(guestId);
    assert.equal(cobrado.unitPriceCents, PRECIO_A);
    assert.equal(cobrado.variant, 'A');
  });

  it('la variante B ve y paga el precio alternativo', async () => {
    const guestId = guestIdEnVariante(experimentId, 'B');
    // Las tres superficies tienen que decir lo mismo: la carta, la ficha del
    // plato y lo que termina en la linea del pedido.
    assert.equal(await precioEnLaCarta(guestId), PRECIO_B);
    assert.equal(await precioEnLaFicha(guestId), PRECIO_B);

    const cobrado = await precioCobrado(guestId);
    assert.equal(cobrado.unitPriceCents, PRECIO_B);
    assert.equal(cobrado.variant, 'B');
  });

  it('sin guestId se sirve el control, y se cobra el control', async () => {
    // Es la unica respuesta segura cuando no hay con que asignar.
    assert.equal(await precioEnLaCarta(), PRECIO_A);
    assert.equal(await precioEnLaFicha(), PRECIO_A);
    const cobrado = await precioCobrado();
    assert.equal(cobrado.unitPriceCents, PRECIO_A);
    assert.equal(cobrado.variant, null);
  });

  it('la carta dice que variante sirvio, para poder medir', async () => {
    const guestId = guestIdEnVariante(experimentId, 'B');
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG}/menu`,
      query: { guestId },
    });
    const menu = response.json() as { experiments: Record<string, string> };
    assert.equal(menu.experiments[dishId], 'B');
  });
});

describe('reglas de las pruebas', () => {
  it('un plato no puede tener dos pruebas corriendo', async () => {
    const primera = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'DESCRIPTION',
      valueB: 'Otra descripcion',
    });
    assert.equal(primera.statusCode, 201, primera.body);
    const id = (primera.json() as { id: string }).id;

    const segunda = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'PRICE',
      valueB: '123456',
    });
    assert.equal(segunda.statusCode, 409, segunda.body);

    await prisma.experiment.deleteMany({ where: { id } });
  });

  it('probar un valor contra si mismo no se acepta', async () => {
    const response = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'PRICE',
      valueB: String(PRECIO_A),
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.code, 'VARIANTE_IGUAL');
  });

  it('cerrar adoptando B le cambia el precio al plato', async () => {
    const creada = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'PRICE',
      valueB: '777700',
    });
    const id = (creada.json() as { id: string }).id;

    const cerrada = await comoAdmin('POST', `/api/admin/experiments/${id}/stop`, {
      winner: 'B',
    });
    assert.equal(cerrada.statusCode, 200, cerrada.body);

    const plato = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    assert.equal(plato.priceCents, 777700, 'no adopto el precio de B');

    const experimento = await prisma.experiment.findUniqueOrThrow({ where: { id } });
    assert.equal(experimento.status, 'STOPPED');
    assert.equal(experimento.winner, 'B');

    // Y la carta vuelve a mostrar un solo precio para todos.
    const guestB = guestIdEnVariante(id, 'B');
    assert.equal(await precioEnLaCarta(guestB), 777700);

    // Se deja el plato como estaba para las demas pruebas.
    await prisma.dish.update({ where: { id: dishId }, data: { priceCents: PRECIO_A } });
    await prisma.experiment.deleteMany({ where: { id } });
  });

  it('una prueba cerrada no se cierra dos veces', async () => {
    const creada = await comoAdmin('POST', '/api/admin/experiments', {
      dishId,
      field: 'DESCRIPTION',
      valueB: 'Para cerrar dos veces',
    });
    const id = (creada.json() as { id: string }).id;
    await comoAdmin('POST', `/api/admin/experiments/${id}/stop`, {});
    const segunda = await comoAdmin('POST', `/api/admin/experiments/${id}/stop`, {});
    assert.equal(segunda.statusCode, 409);
    await prisma.experiment.deleteMany({ where: { id } });
  });
});

describe('el veredicto no opina de mas', () => {
  const variante = (
    variant: 'A' | 'B',
    vistas: number,
    pedidos: number,
    ingresoCents = pedidos * 500000,
  ): NumerosDeVariante => ({
    variant,
    valor: 'x',
    vistas,
    alCarrito: pedidos,
    pedidos,
    ingresoCents,
    conversion: vistas > 0 ? pedidos / vistas : null,
    ingresoPorVistaCents: vistas > 0 ? Math.round(ingresoCents / vistas) : null,
  });

  it('con poca muestra se niega a decir quien gana', () => {
    // 2 contra 6 de 50 "se ve" como una diferencia enorme, y es ruido.
    const v = veredictoDe(variante('A', 50, 2), variante('B', 50, 6));
    assert.equal(v.clase, 'falta-muestra');
    assert.match(v.mensaje, /ruido/);
  });

  it('con muestra suficiente y diferencia chica, dice que no hay diferencia', () => {
    const v = veredictoDe(variante('A', 1000, 50), variante('B', 1000, 54));
    assert.equal(v.clase, 'sin-diferencia');
  });

  it('con muestra suficiente y diferencia grande, dice quien gana', () => {
    const v = veredictoDe(variante('A', 1000, 50), variante('B', 1000, 110));
    assert.equal(v.clase, 'gana');
    assert.equal(v.clase === 'gana' && v.ganadora, 'B');
    assert.ok(v.clase === 'gana' && v.valorP < 0.05, 'el valor p tendria que ser chico');
  });

  it('sin una sola visita, lo dice y no calcula nada', () => {
    const v = veredictoDe(variante('A', 0, 0), variante('B', 0, 0));
    assert.equal(v.clase, 'sin-datos');
  });

  it('la prueba de proporciones da los numeros conocidos', () => {
    // 50/1000 contra 110/1000: z alrededor de -4,4 y p practicamente cero.
    const r = pruebaDeProporciones(50, 1000, 110, 1000);
    assert.ok(r, 'no calculo');
    assert.ok(r.z < -4 && r.z > -5, `z fue ${r.z}`);
    assert.ok(r.valorP < 0.0001, `p fue ${r.valorP}`);

    // Dos proporciones iguales: z cero, p uno.
    const iguales = pruebaDeProporciones(50, 1000, 50, 1000)!;
    assert.equal(Math.round(iguales.z * 1000) / 1000, 0);
    assert.ok(iguales.valorP > 0.99);

    // Sin conversiones no se puede comparar.
    assert.equal(pruebaDeProporciones(0, 100, 0, 100), null);
  });
});
