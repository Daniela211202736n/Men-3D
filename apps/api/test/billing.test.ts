/**
 * Cobro recurrente del abono.
 *
 * Lo que se prueba aca es la maquina de estados y la degradacion, que es donde
 * estan las decisiones. El dialogo con MercadoPago no: eso necesita una cuenta
 * real y esta anotado en ROADMAP.md como lo que falta probar.
 *
 * La regla que ordena todo: **si no paga, el restaurante vuelve al plan
 * gratuito; no se le apaga la carta.** El QR esta pegado en las mesas, y un
 * comensal que lo escanea un viernes a la noche y encuentra una pagina muerta
 * concluye que el producto no anda, delante de sus invitados.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import { PLAN_FEATURES } from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { getTenantFeatures, invalidateTenantFeatures } from '../src/modules/plans/features.js';
import {
  DIAS_DE_GRACIA,
  cancelar,
  featuresVigentes,
  graciaVencida,
  registrarAviso,
  registrarCobro,
  registrarCobroFallido,
  suspenderVencidas,
} from '../src/modules/billing/service.js';
import { cobroEntro, mapEstadoSuscripcion } from '../src/modules/billing/mercadopago.js';

const SUFFIX = Date.now();
const SLUG = `abono-${SUFFIX}`;
const EMAIL_DUEÑO = `dueno-abono-${SUFFIX}@prueba.demo`;
const PASSWORD = 'clave-de-prueba-123';

let app: FastifyInstance;
let tenantId: string;
let subscriptionId: string;

const DIA = 24 * 60 * 60_000;

async function ponerEstado(data: Record<string, unknown>) {
  await prisma.subscription.update({ where: { id: subscriptionId }, data });
  invalidateTenantFeatures(tenantId);
}

before(async () => {
  app = await buildApp();
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Abono', defaultLocale: 'es' },
  });
  tenantId = tenant.id;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: 'PRO' } });
  const sub = await prisma.subscription.create({
    data: { tenantId, planId: plan.id, status: 'ACTIVE' },
  });
  subscriptionId = sub.id;

  await prisma.user.create({
    data: {
      tenantId,
      email: EMAIL_DUEÑO,
      name: 'Dueño',
      role: 'OWNER',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
});

/** Token del dueño de este restaurante. */
async function tokenDelDueño(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: EMAIL_DUEÑO, password: PASSWORD },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token as string;
}

beforeEach(async () => {
  await ponerEstado({ status: 'ACTIVE', graceEndsAt: null, canceledAt: null });
});

after(async () => {
  await prisma.billingEvent.deleteMany({ where: { subscriptionId } });
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

describe('traduccion de estados de MercadoPago', () => {
  it('pending no es activo', () => {
    // Abrir el checkout y cerrarlo no autoriza ningun debito. Tratarlo como
    // activo regalaria el plan.
    assert.equal(mapEstadoSuscripcion('pending'), null);
  });

  it('authorized es activo y cancelled es baja', () => {
    assert.equal(mapEstadoSuscripcion('authorized'), 'ACTIVE');
    assert.equal(mapEstadoSuscripcion('cancelled'), 'CANCELED');
  });

  it('paused arranca la gracia', () => {
    // MercadoPago pausa sola tras varios intentos fallidos.
    assert.equal(mapEstadoSuscripcion('paused'), 'PAST_DUE');
  });

  it('recycling no cuenta como cobrado', () => {
    // "Lo esta reintentando" no es "entro".
    assert.equal(cobroEntro('recycling'), false);
    assert.equal(cobroEntro('processed'), true);
  });
});

describe('que pierde el restaurante que no paga', () => {
  it('al dia tiene todo lo del plan', () => {
    const pro = [...PLAN_FEATURES.PRO];
    assert.deepEqual(featuresVigentes('ACTIVE', pro), pro);
    assert.deepEqual(featuresVigentes('TRIALING', pro), pro);
  });

  it('en gracia no pierde nada todavia', () => {
    // PAST_DUE son los dias para arreglar la tarjeta: nadie se entera.
    assert.deepEqual(featuresVigentes('PAST_DUE', [...PLAN_FEATURES.PRO]), [
      ...PLAN_FEATURES.PRO,
    ]);
  });

  it('suspendido conserva el visor 3D', () => {
    // Lo que ve el comensal sigue en pie; se apaga lo que usa el restaurante.
    const vigentes = featuresVigentes('SUSPENDED', [...PLAN_FEATURES.PRO]);
    assert.ok(vigentes.includes('AR_VIEWER'), 'la carta en 3D tiene que seguir');
    assert.ok(!vigentes.includes('ADVANCED_ANALYTICS'));
    assert.ok(!vigentes.includes('ONLINE_ORDERING'));
    assert.deepEqual(vigentes, [...PLAN_FEATURES.FREE]);
  });

  it('dado de baja, lo mismo', () => {
    assert.deepEqual(featuresVigentes('CANCELED', [...PLAN_FEATURES.PRO]), [
      ...PLAN_FEATURES.FREE,
    ]);
  });
});

describe('periodo de gracia', () => {
  it('un cobro fallido no apaga nada en el acto', async () => {
    await registrarCobroFallido(subscriptionId);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    assert.equal(sub.status, 'PAST_DUE');
    assert.ok(sub.graceEndsAt, 'tiene que fijar hasta cuando dura la gracia');

    const features = await getTenantFeatures(tenantId);
    assert.ok(features.includes('ADVANCED_ANALYTICS'), 'en gracia sigue todo');
  });

  it('reintentar no renueva la gracia', async () => {
    // Si cada intento fallido corriera el plazo, la gracia seria infinita.
    await registrarCobroFallido(subscriptionId);
    const primera = (await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    })).graceEndsAt;

    await registrarCobroFallido(subscriptionId, new Date(Date.now() + 3 * DIA));
    const segunda = (await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    })).graceEndsAt;

    assert.deepEqual(segunda, primera, 'la gracia se fija una sola vez');
  });

  it('vencida la gracia, pasa a suspendido', async () => {
    await ponerEstado({
      status: 'PAST_DUE',
      graceEndsAt: new Date(Date.now() - DIA),
    });
    const suspendidas = await suspenderVencidas();
    assert.ok(suspendidas >= 1);

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    assert.equal(sub.status, 'SUSPENDED');

    const features = await getTenantFeatures(tenantId);
    assert.deepEqual(features, [...PLAN_FEATURES.FREE]);
  });

  it('la gracia vencida se nota aunque la tarea no haya corrido', () => {
    // El dueño que entra el dia 8 tiene que ver la verdad.
    assert.equal(graciaVencida('PAST_DUE', new Date(Date.now() - DIA)), true);
    assert.equal(graciaVencida('PAST_DUE', new Date(Date.now() + DIA)), false);
    assert.equal(graciaVencida('ACTIVE', new Date(Date.now() - DIA)), false);
  });

  it('la gracia dura lo que dice la constante', async () => {
    const antes = Date.now();
    await registrarCobroFallido(subscriptionId);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const dias = (sub.graceEndsAt!.getTime() - antes) / DIA;
    assert.ok(Math.abs(dias - DIAS_DE_GRACIA) < 0.1, `fueron ${dias} dias`);
  });
});

describe('volver a cobrar lo devuelve todo', () => {
  it('desde suspendido, sin perder nada de lo cargado', async () => {
    await ponerEstado({ status: 'SUSPENDED', graceEndsAt: new Date(Date.now() - DIA) });
    assert.deepEqual(await getTenantFeatures(tenantId), [...PLAN_FEATURES.FREE]);

    await registrarCobro(subscriptionId, new Date(Date.now() + 30 * DIA));

    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    assert.equal(sub.status, 'ACTIVE');
    assert.equal(sub.graceEndsAt, null, 'si vuelve a fallar, la gracia arranca de cero');
    assert.ok(sub.lastPaymentAt);

    const features = await getTenantFeatures(tenantId);
    assert.ok(features.includes('ADVANCED_ANALYTICS'), 'vuelve el plan contratado');
  });

  it('la baja no toca la carta', async () => {
    const plato = await prisma.category
      .create({ data: { tenantId, name: 'Prueba', position: 0 } })
      .then((cat) =>
        prisma.dish.create({
          data: { tenantId, categoryId: cat.id, name: 'Sigue ahi', priceCents: 1000 },
        }),
      );

    await cancelar(subscriptionId);

    const siguiendo = await prisma.dish.findUnique({ where: { id: plato.id } });
    assert.ok(siguiendo, 'dar de baja el abono no borra la carta');
    assert.deepEqual(await getTenantFeatures(tenantId), [...PLAN_FEATURES.FREE]);
  });
});

describe('avisos repetidos de la pasarela', () => {
  it('el mismo aviso no se aplica dos veces', async () => {
    const eventId = `evento-${Date.now()}`;
    const primero = await registrarAviso({
      provider: 'mercadopago',
      eventId,
      type: 'authorized_payment',
      payload: { hola: 'mundo' },
      subscriptionId,
    });
    const segundo = await registrarAviso({
      provider: 'mercadopago',
      eventId,
      type: 'authorized_payment',
      payload: { hola: 'mundo' },
      subscriptionId,
    });

    assert.equal(primero.esNuevo, true);
    assert.equal(segundo.esNuevo, false, 'un reintento correria el periodo dos veces');
  });

  it('avisos distintos si se registran', async () => {
    const a = await registrarAviso({
      provider: 'mercadopago',
      eventId: `a-${Date.now()}`,
      type: 'preapproval',
      payload: {},
      subscriptionId,
    });
    const b = await registrarAviso({
      provider: 'mercadopago',
      eventId: `b-${Date.now()}`,
      type: 'preapproval',
      payload: {},
      subscriptionId,
    });
    assert.equal(a.esNuevo, true);
    assert.equal(b.esNuevo, true);
  });
});

describe('el webhook no se cree cualquier cosa', () => {
  it('sin firma valida, no aplica nada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook/mercadopago/subscription',
      payload: { type: 'subscription_authorized_payment', data: { id: 'inventado' } },
    });
    // Sin secreto configurado o con firma invalida: 401, nunca un cobro dado
    // por bueno. Un aviso sin verificar es un plan regalado a quien sepa la URL.
    assert.equal(response.statusCode, 401, response.body);
  });
});

describe('la pantalla de plan no se contradice', () => {
  it('con la gracia vencida, el estado y las funciones concuerdan', async () => {
    // El cache de features dura 60 segundos y cada instancia de la API tiene el
    // suyo. Si `status` saliera de la base y `features` del cache, la respuesta
    // podria decir "suspendido" y listar el plan pago a la vez.
    // Primero se calienta el cache con el plan pago, estando al dia: sin este
    // paso el cache esta vacio, `getTenantFeatures` lee de la base y la
    // contradiccion no llega a existir —la prueba pasaria igual rota.
    await ponerEstado({ status: 'ACTIVE', graceEndsAt: null });
    const calentado = await getTenantFeatures(tenantId);
    assert.ok(calentado.includes('ADVANCED_ANALYTICS'), 'el cache quedo con el plan pago');

    // Y ahora se vence la gracia por detras, SIN invalidar: es exactamente lo
    // que pasa entre instancias de la API, que tienen cada una su cache.
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'PAST_DUE', graceEndsAt: new Date(Date.now() - DIA) },
    });
    assert.ok(
      (await getTenantFeatures(tenantId)).includes('ADVANCED_ANALYTICS'),
      'el cache tiene que seguir desactualizado para que la prueba valga',
    );

    const token = await tokenDelDueño();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/plan',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 200, response.body);

    const body = response.json() as { status: string; features: string[] };
    assert.equal(body.status, 'SUSPENDED');
    assert.deepEqual(
      body.features,
      [...PLAN_FEATURES.FREE],
      'decia suspendido y listaba las funciones del plan pago',
    );
  });
});
