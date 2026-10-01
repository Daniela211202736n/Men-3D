/**
 * Aislamiento entre restaurantes.
 *
 * Es la propiedad de la que depende todo el diseño multi-tenant: un restaurante
 * no puede ver ni tocar nada de otro. Si esto se rompe, el fallo no es un error
 * visible sino una fuga silenciosa, asi que se prueba contra la API real —con
 * sus guardias, su autenticacion y su base— y no contra los servicios.
 *
 * El patron de cada caso es el mismo: con el token del restaurante A se intenta
 * leer o modificar algo del restaurante B.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const PASSWORD = 'clave-de-prueba-123';
const SUFFIX = Date.now();
const SLUG_A = `aislamiento-a-${SUFFIX}`;
const SLUG_B = `aislamiento-b-${SUFFIX}`;
/** Unico por ejecucion: un id repetido hace leer el evento de una corrida vieja. */
const SESSION_ID = `sesion-aislamiento-${SUFFIX}`;

interface Restaurante {
  tenantId: string;
  slug: string;
  token: string;
  categoryId: string;
  dishId: string;
  orderId: string;
  reviewId: string;
}

let app: FastifyInstance;
let A: Restaurante;
let B: Restaurante;

/** Crea un restaurante completo con un plato, un pedido y una reseña. */
async function crearRestaurante(
  slug: string,
  email: string,
  codigoPedido: string,
): Promise<Omit<Restaurante, 'token'>> {
  const plan = await prisma.plan.findFirst({ where: { tier: 'PRO' } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: `Restaurante ${slug}`,
      currency: 'ARS',
      enabledLocales: 'es',
      serviceModes: 'DINE_IN',
      branding: { create: {} },
      ...(plan
        ? { subscription: { create: { planId: plan.id, status: 'ACTIVE' } } }
        : {}),
      users: {
        create: { email, name: 'Dueño', passwordHash, role: 'OWNER' },
      },
      categories: { create: { name: 'Principales', position: 0 } },
    },
    include: { categories: true },
  });

  const dish = await prisma.dish.create({
    data: {
      tenantId: tenant.id,
      categoryId: tenant.categories[0]!.id,
      name: `Plato secreto de ${slug}`,
      priceCents: 500_000,
      modelGlbUrl: '/models/milanesa-napolitana.glb',
    },
  });

  const order = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      // Distinto por restaurante a proposito: el codigo solo es unico dentro de
      // un tenant, asi que con el mismo codigo la prueba se engaña sola
      // encontrando el pedido propio.
      code: codigoPedido,
      status: 'PAID',
      serviceMode: 'DINE_IN',
      subtotalCents: 500_000,
      totalCents: 500_000,
      items: {
        create: {
          dishId: dish.id,
          nameSnapshot: dish.name,
          unitPriceCents: 500_000,
          quantity: 1,
        },
      },
    },
  });

  const review = await prisma.review.create({
    data: {
      tenantId: tenant.id,
      dishId: dish.id,
      rating: 5,
      comment: `Opinion de ${slug}`,
      authorName: 'Comensal',
      guestId: `guest-privado-${slug}`,
      status: 'PUBLISHED',
    },
  });

  return {
    tenantId: tenant.id,
    slug,
    categoryId: tenant.categories[0]!.id,
    dishId: dish.id,
    orderId: order.id,
    reviewId: review.id,
  };
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, `login de ${email}: ${response.body}`);
  return response.json().token as string;
}

/** Petición del backoffice con el token del restaurante indicado. */
function comoAdmin(
  restaurante: Restaurante,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${restaurante.token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

before(async () => {
  app = await buildApp();
  await app.ready();

  const datosA = await crearRestaurante(SLUG_A, `duenio-a-${SUFFIX}@prueba.demo`, 'AAA1');
  const datosB = await crearRestaurante(SLUG_B, `duenio-b-${SUFFIX}@prueba.demo`, 'BBB2');

  A = { ...datosA, token: await login(`duenio-a-${SUFFIX}@prueba.demo`) };
  B = { ...datosB, token: await login(`duenio-b-${SUFFIX}@prueba.demo`) };
});

after(async () => {
  await app.close();
  // Tambien barre restos de ejecuciones anteriores que se hayan cortado antes
  // de limpiar: si quedan, contaminan las consultas de la proxima corrida.
  const restos = await prisma.tenant.findMany({
    where: { slug: { startsWith: 'aislamiento-' } },
    select: { slug: true },
  });
  await deleteTenantsBySlug(restos.map((t) => t.slug));
  await prisma.$disconnect();
});

/* ------------------------------------------------------------- lectura */

describe('lectura: un restaurante solo ve lo suyo', () => {
  it('la lista de platos no incluye los del otro', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/dishes');
    assert.equal(response.statusCode, 200);
    const platos = response.json() as Array<{ id: string; name: string }>;
    assert.ok(platos.length > 0, 'A ve sus propios platos');
    assert.equal(
      platos.some((p) => p.id === B.dishId),
      false,
      'no aparece ningun plato de B',
    );
    assert.equal(
      platos.some((p) => p.name.includes(SLUG_B)),
      false,
    );
  });

  it('la lista de categorias no incluye las del otro', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/categories');
    const categorias = response.json() as Array<{ id: string }>;
    assert.equal(categorias.some((c) => c.id === B.categoryId), false);
  });

  it('la lista de pedidos no incluye los del otro', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/orders');
    const pedidos = response.json() as Array<{ id: string }>;
    assert.equal(pedidos.some((o) => o.id === B.orderId), false);
  });

  it('el tablero de cocina no muestra pedidos ajenos', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/kds/board');
    const cuerpo = JSON.stringify(response.json());
    assert.equal(cuerpo.includes(B.orderId), false);
  });

  it('la moderacion de reseñas no lista las del otro', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/reviews');
    const reseñas = response.json() as Array<{ id: string }>;
    assert.equal(reseñas.some((r) => r.id === B.reviewId), false);
  });

  it('los datos del local son los propios', async () => {
    const response = await comoAdmin(A, 'GET', '/api/admin/venue');
    assert.equal(response.json().slug, SLUG_A);
  });
});

/* ----------------------------------------------------------- escritura */

describe('escritura: no se puede tocar lo ajeno', () => {
  it('no puede cambiar el precio de un plato ajeno', async () => {
    const response = await comoAdmin(A, 'PATCH', `/api/admin/dishes/${B.dishId}/price`, {
      priceCents: 1,
    });
    assert.equal(response.statusCode, 404);

    const plato = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    assert.equal(plato.priceCents, 500_000, 'el precio de B no se movio');
  });

  it('no puede marcar agotado un plato ajeno', async () => {
    const response = await comoAdmin(
      A,
      'PATCH',
      `/api/admin/dishes/${B.dishId}/availability`,
      { isAvailable: false },
    );
    assert.equal(response.statusCode, 404);
    const plato = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    assert.equal(plato.isAvailable, true);
  });

  it('no puede editar un plato ajeno', async () => {
    const response = await comoAdmin(A, 'PATCH', `/api/admin/dishes/${B.dishId}`, {
      name: 'Secuestrado',
    });
    assert.equal(response.statusCode, 404);
    const plato = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    assert.notEqual(plato.name, 'Secuestrado');
  });

  it('no puede dar de baja un plato ajeno', async () => {
    const response = await comoAdmin(A, 'DELETE', `/api/admin/dishes/${B.dishId}`);
    assert.equal(response.statusCode, 404);
    const plato = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    assert.equal(plato.archivedAt, null);
  });

  it('no puede borrar una categoria ajena', async () => {
    const response = await comoAdmin(A, 'DELETE', `/api/admin/categories/${B.categoryId}`);
    // 404 o 409 (si la categoria tiene platos): lo que importa es que no borre.
    assert.ok(response.statusCode >= 400, `devolvio ${response.statusCode}`);
    const categoria = await prisma.category.findUnique({ where: { id: B.categoryId } });
    assert.ok(categoria, 'la categoria de B sigue existiendo');
  });

  it('no puede renombrar una categoria ajena', async () => {
    const response = await comoAdmin(A, 'PATCH', `/api/admin/categories/${B.categoryId}`, {
      name: 'Secuestrada',
    });
    assert.equal(response.statusCode, 404);
  });

  it('reordenar con ids ajenos no los mueve', async () => {
    // El endpoint acepta una lista de ids; los que no son suyos deben ignorarse.
    const antes = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    const response = await comoAdmin(A, 'PUT', '/api/admin/dishes/order', {
      ids: [B.dishId, A.dishId],
    });
    assert.equal(response.statusCode, 200);
    const despues = await prisma.dish.findUniqueOrThrow({ where: { id: B.dishId } });
    assert.equal(despues.position, antes.position, 'el plato de B no se reordeno');
  });

  it('no puede mover el estado de un pedido ajeno', async () => {
    const response = await comoAdmin(A, 'PATCH', `/api/admin/orders/${B.orderId}/status`, {
      status: 'IN_KITCHEN',
    });
    assert.equal(response.statusCode, 404);
    const pedido = await prisma.order.findUniqueOrThrow({ where: { id: B.orderId } });
    assert.equal(pedido.status, 'PAID');
  });

  it('no puede moderar una reseña ajena', async () => {
    const response = await comoAdmin(A, 'PATCH', `/api/admin/reviews/${B.reviewId}`, {
      status: 'HIDDEN',
    });
    assert.equal(response.statusCode, 404);
    const reseña = await prisma.review.findUniqueOrThrow({ where: { id: B.reviewId } });
    assert.equal(reseña.status, 'PUBLISHED');
  });

  it('no puede crear un plato en una categoria ajena', async () => {
    const response = await comoAdmin(A, 'POST', '/api/admin/dishes', {
      categoryId: B.categoryId,
      name: 'Plato infiltrado',
      priceCents: 1000,
    });
    assert.equal(response.statusCode, 404);
    const infiltrado = await prisma.dish.findFirst({
      where: { name: 'Plato infiltrado' },
    });
    assert.equal(infiltrado, null);
  });

  it('no puede crear un maridaje que apunte a un plato ajeno', async () => {
    const response = await comoAdmin(A, 'POST', `/api/admin/dishes/${A.dishId}/pairings`, {
      suggestedDishId: B.dishId,
    });
    assert.equal(response.statusCode, 404);
    const maridaje = await prisma.pairing.findFirst({
      where: { suggestedDishId: B.dishId },
    });
    assert.equal(maridaje, null);
  });

  it('no puede traducir a mano un plato ajeno', async () => {
    const response = await comoAdmin(
      A,
      'PUT',
      `/api/admin/translations/${B.dishId}/en`,
      { name: 'Hijacked dish' },
    );
    assert.ok(response.statusCode >= 400, `devolvio ${response.statusCode}`);
    const traduccion = await prisma.dishTranslation.findFirst({
      where: { dishId: B.dishId },
    });
    assert.equal(traduccion, null);
  });

  it('cambiar los datos del local solo afecta al propio', async () => {
    await comoAdmin(A, 'PATCH', '/api/admin/venue', { name: 'Nombre nuevo de A' });
    const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: B.tenantId } });
    assert.notEqual(tenantB.name, 'Nombre nuevo de A');
  });
});

/* -------------------------------------------------------- superficie publica */

describe('la carta publica no filtra entre restaurantes', () => {
  it('el menu de A no trae platos de B', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/menu`,
    });
    assert.equal(response.statusCode, 200);
    const cuerpo = JSON.stringify(response.json());
    assert.equal(cuerpo.includes(B.dishId), false);
    assert.equal(cuerpo.includes(SLUG_B), false);
  });

  it('pedir un plato de B por la URL de A da 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/dishes/${B.dishId}`,
    });
    assert.equal(response.statusCode, 404);
  });

  it('las reseñas de A no incluyen las de B', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/reviews`,
    });
    const cuerpo = JSON.stringify(response.json());
    assert.equal(cuerpo.includes(B.reviewId), false);
  });

  it('no se puede dejar una reseña de A apuntando a un plato de B', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/${SLUG_A}/reviews`,
      payload: { dishId: B.dishId, rating: 1, comment: 'Infiltrada' },
    });
    assert.equal(response.statusCode, 404);
  });

  it('no se puede pedir en A un plato de B', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/${SLUG_A}/orders`,
      payload: { items: [{ dishId: B.dishId, quantity: 1 }] },
    });
    assert.ok(response.statusCode >= 400, `devolvio ${response.statusCode}`);
    assert.equal(response.json().error.code, 'DISH_UNAVAILABLE');
  });

  it('consultar un pedido de B por la URL de A da 404', async () => {
    const pedidoB = await prisma.order.findUniqueOrThrow({ where: { id: B.orderId } });
    assert.equal(pedidoB.code, 'BBB2');

    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/orders/${pedidoB.code}`,
    });
    assert.equal(response.statusCode, 404);

    // Y el propio si se encuentra, para que la prueba no pase por estar rota.
    const propio = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/orders/AAA1`,
    });
    assert.equal(propio.statusCode, 200);
    assert.equal(propio.json().code, 'AAA1');
  });

  it('los maridajes de un plato ajeno no se resuelven', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_A}/dishes/${B.dishId}/pairings`,
    });
    // Sin el plato no hay nada que sugerir.
    assert.deepEqual(response.json(), []);
  });

  it('los eventos de analitica no pueden atribuirse a un plato ajeno', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/public/${SLUG_A}/events`,
      payload: {
        events: [
          { type: 'DISH_VIEW_3D', dishId: B.dishId, sessionId: SESSION_ID },
        ],
      },
    });
    assert.equal(response.statusCode, 202);

    // El evento se acepta pero se guarda sin plato: no infla las metricas de B.
    const evento = await prisma.analyticsEvent.findFirst({
      where: { sessionId: SESSION_ID },
    });
    assert.ok(evento, 'el evento se registro');
    assert.equal(evento.dishId, null, 'no quedo atribuido al plato de B');
    assert.equal(evento.tenantId, A.tenantId, 'quedo en el tenant de la URL');
  });

  it('la reseña publica no expone el identificador del comensal', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/public/${SLUG_B}/reviews`,
    });
    const cuerpo = JSON.stringify(response.json());
    assert.equal(cuerpo.includes('guest-privado'), false);
  });
});

/* --------------------------------------------------------------- tokens */

describe('tokens y sesiones', () => {
  it('sin token no se entra al backoffice', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/dishes' });
    assert.equal(response.statusCode, 401);
  });

  it('un token manipulado se rechaza', async () => {
    const roto = `${A.token.slice(0, -4)}xxxx`;
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dishes',
      headers: { authorization: `Bearer ${roto}` },
    });
    assert.equal(response.statusCode, 401);
  });

  it('un usuario dado de baja pierde el acceso aunque su token siga vigente', async () => {
    const extra = await prisma.user.create({
      data: {
        tenantId: A.tenantId,
        email: `temporal-${SUFFIX}@prueba.demo`,
        name: 'Temporal',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        role: 'ADMIN',
      },
    });
    const token = await login(extra.email);

    const antes = await app.inject({
      method: 'GET',
      url: '/api/admin/dishes',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(antes.statusCode, 200);

    await prisma.user.update({ where: { id: extra.id }, data: { isActive: false } });

    const despues = await app.inject({
      method: 'GET',
      url: '/api/admin/dishes',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(despues.statusCode, 401, 'el token deja de servir al instante');
  });

  it('el ticket del KDS no sirve para el resto del backoffice', async () => {
    const ticketResponse = await comoAdmin(A, 'POST', '/api/admin/kds/ticket');
    assert.equal(ticketResponse.statusCode, 200);
    const { ticket } = ticketResponse.json() as { ticket: string };

    // El ticket es un JWT valido firmado con la misma clave, asi que sin una
    // comprobacion explicita de alcance abriria el backoffice entero durante
    // sus 60 segundos de vida — y viaja en una URL.
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/dishes',
      headers: { authorization: `Bearer ${ticket}` },
    });
    assert.equal(response.statusCode, 401);
  });

  // El camino feliz del stream no se prueba por inyeccion: la respuesta queda
  // abierta a proposito, asi que la peticion inyectada nunca termina y cuelga
  // la suite entera. Que el ticket abre el stream esta verificado en el
  // navegador: el KDS muestra "EN VIVO".

  it('un token de sesion no sirve como ticket del stream', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/kds/stream?ticket=${encodeURIComponent(A.token)}`,
    });
    assert.equal(response.statusCode, 401);
  });
});
