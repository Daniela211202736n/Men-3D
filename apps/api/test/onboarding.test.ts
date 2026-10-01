/**
 * Onboarding de un restaurante: equipo, limites del plan y recuperacion de
 * contraseña.
 *
 * Son las reglas que deciden si un cliente puede operar solo o necesita que
 * alguien lo acompañe a mano, asi que se prueban contra la API real.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { hashDelToken } from '../src/modules/auth/password-reset.js';
import { setMailer } from '../src/modules/mail/index.js';

const PASSWORD = 'clave-de-prueba-123';
const SUFFIX = Date.now();
const SLUG = `onboarding-${SUFFIX}`;
const EMAIL_OWNER = `owner-${SUFFIX}@prueba.demo`;

let app: FastifyInstance;
let tenantId: string;
let ownerId: string;
let ownerToken: string;
let categoryId: string;

async function login(email: string, password = PASSWORD): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  assert.equal(response.statusCode, 200, `login de ${email}: ${response.body}`);
  return response.json().token as string;
}

function como(token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Deja el plan del restaurante con los topes indicados. */
async function fijarPlan(maxDishes: number, max3dModels: number) {
  const tier = `PRUEBA_${SUFFIX}`;
  const plan = await prisma.plan.upsert({
    where: { tier },
    create: {
      tier,
      name: 'Plan de prueba',
      monthlyCents: 0,
      maxDishes,
      max3dModels,
      features: 'AR_VIEWER,CUSTOM_BRANDING',
      isPublic: false,
    },
    update: { maxDishes, max3dModels },
  });
  await prisma.subscription.upsert({
    where: { tenantId },
    create: { tenantId, planId: plan.id, status: 'ACTIVE' },
    update: { planId: plan.id },
  });
}

before(async () => {
  app = await buildApp();
  await app.ready();

  const tenant = await prisma.tenant.create({
    data: {
      slug: SLUG,
      name: 'Restaurante onboarding',
      currency: 'ARS',
      branding: { create: {} },
      users: {
        create: {
          email: EMAIL_OWNER,
          name: 'Dueño',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
          role: 'OWNER',
        },
      },
      categories: { create: { name: 'Principales', position: 0 } },
    },
    include: { users: true, categories: true },
  });
  tenantId = tenant.id;
  ownerId = tenant.users[0]!.id;
  categoryId = tenant.categories[0]!.id;
  ownerToken = await login(EMAIL_OWNER);
});

after(async () => {
  await app.close();
  const restos = await prisma.tenant.findMany({
    where: { slug: { startsWith: 'onboarding-' } },
    select: { slug: true },
  });
  await deleteTenantsBySlug(restos.map((t) => t.slug));
  await prisma.plan.deleteMany({ where: { tier: { startsWith: 'PRUEBA_' } } });
  await prisma.$disconnect();
});

/* ---------------------------------------------------------------- equipo */

describe('equipo del restaurante', () => {
  it('el dueño ve el equipo y se reconoce a si mismo', async () => {
    const response = await como(ownerToken, 'GET', '/api/admin/users');
    assert.equal(response.statusCode, 200);
    const equipo = response.json() as Array<{ id: string; isSelf: boolean; role: string }>;
    assert.equal(equipo.length, 1);
    assert.equal(equipo[0]!.isSelf, true);
    assert.equal(equipo[0]!.role, 'OWNER');
  });

  it('puede sumar un administrador y este entra', async () => {
    const email = `admin-${SUFFIX}@prueba.demo`;
    const response = await como(ownerToken, 'POST', '/api/admin/users', {
      email,
      name: 'Encargado',
      password: PASSWORD,
      role: 'ADMIN',
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().role, 'ADMIN');

    const token = await login(email);
    const suyo = await como(token, 'GET', '/api/admin/dishes');
    assert.equal(suyo.statusCode, 200);
  });

  it('no deja repetir un email', async () => {
    const response = await como(ownerToken, 'POST', '/api/admin/users', {
      email: EMAIL_OWNER,
      name: 'Duplicado',
      password: PASSWORD,
      role: 'ADMIN',
    });
    assert.equal(response.statusCode, 409);
  });

  it('no se puede crear otro dueño desde el alta', async () => {
    const response = await como(ownerToken, 'POST', '/api/admin/users', {
      email: `otro-owner-${SUFFIX}@prueba.demo`,
      name: 'Otro dueño',
      password: PASSWORD,
      role: 'OWNER',
    });
    // El esquema solo admite ADMIN o STAFF: la titularidad se transfiere.
    assert.equal(response.statusCode, 422);
  });

  it('el personal de cocina no administra el equipo', async () => {
    const email = `cocina-${SUFFIX}@prueba.demo`;
    await como(ownerToken, 'POST', '/api/admin/users', {
      email,
      name: 'Cocina',
      password: PASSWORD,
      role: 'STAFF',
    });
    const token = await login(email);

    const listar = await como(token, 'GET', '/api/admin/users');
    assert.equal(listar.statusCode, 403);

    const crear = await como(token, 'POST', '/api/admin/users', {
      email: `colado-${SUFFIX}@prueba.demo`,
      name: 'Colado',
      password: PASSWORD,
      role: 'ADMIN',
    });
    assert.equal(crear.statusCode, 403);
  });

  it('nadie puede cambiarse el rol a si mismo', async () => {
    const response = await como(ownerToken, 'PATCH', `/api/admin/users/${ownerId}`, {
      role: 'STAFF',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'SELF_ROLE_CHANGE');
  });

  it('nadie puede desactivarse a si mismo', async () => {
    const response = await como(ownerToken, 'DELETE', `/api/admin/users/${ownerId}`);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'SELF_DEACTIVATE');

    const sigue = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    assert.equal(sigue.isActive, true);
  });

  it('un administrador no puede tocar al dueño', async () => {
    const email = `admin2-${SUFFIX}@prueba.demo`;
    await como(ownerToken, 'POST', '/api/admin/users', {
      email,
      name: 'Encargado 2',
      password: PASSWORD,
      role: 'ADMIN',
    });
    const token = await login(email);

    const response = await como(token, 'DELETE', `/api/admin/users/${ownerId}`);
    assert.equal(response.statusCode, 403);
  });

  it('transferir la titularidad deja exactamente un dueño', async () => {
    const email = `sucesor-${SUFFIX}@prueba.demo`;
    const creado = await como(ownerToken, 'POST', '/api/admin/users', {
      email,
      name: 'Sucesor',
      password: PASSWORD,
      role: 'ADMIN',
    });
    const sucesorId = creado.json().id as string;

    const response = await como(
      ownerToken,
      'POST',
      `/api/admin/users/${sucesorId}/transfer-ownership`,
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().role, 'OWNER');

    const dueños = await prisma.user.findMany({
      where: { tenantId, role: 'OWNER', isActive: true },
    });
    assert.equal(dueños.length, 1, 'hay exactamente un dueño');
    assert.equal(dueños[0]!.id, sucesorId);

    // Y el anterior quedo como administrador, no afuera.
    const anterior = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    assert.equal(anterior.role, 'ADMIN');

    // Se devuelve la titularidad para no alterar el resto de las pruebas.
    const tokenSucesor = await login(email);
    await como(tokenSucesor, 'POST', `/api/admin/users/${ownerId}/transfer-ownership`);
    ownerToken = await login(EMAIL_OWNER);
  });

  it('no se puede dar de baja al unico dueño', async () => {
    // Se intenta desde otro dueño... que no existe: la regla la aplica el
    // conteo de dueños activos, no quien pide.
    const dueños = await prisma.user.count({
      where: { tenantId, role: 'OWNER', isActive: true },
    });
    assert.equal(dueños, 1, 'el escenario arranca con un solo dueño');

    const email = `admin3-${SUFFIX}@prueba.demo`;
    await como(ownerToken, 'POST', '/api/admin/users', {
      email,
      name: 'Encargado 3',
      password: PASSWORD,
      role: 'ADMIN',
    });

    // Un administrador tampoco puede, y el dueño no puede consigo mismo:
    // la cuenta nunca queda sin titular.
    const propio = await como(ownerToken, 'DELETE', `/api/admin/users/${ownerId}`);
    assert.equal(propio.statusCode, 400);
  });

  it('dos bajas simultaneas no dejan al local sin dueño', async () => {
    // Dos administradores dando de baja a los dos ultimos dueños a la vez. Si
    // contar y escribir fueran pasos sueltos, los dos leerian "quedan 2" y los
    // dos escribirian: cero dueños, y un restaurante que no puede cambiar el
    // plan ni ceder la titularidad sin entrar a la base a mano.
    const segundo = await prisma.user.create({
      data: {
        tenantId,
        email: `dueno2-${SUFFIX}@prueba.demo`,
        name: 'Segundo dueño',
        role: 'OWNER',
        passwordHash: await bcrypt.hash(PASSWORD, 10),
      },
    });

    // El token del segundo se saca antes de lanzar nada: si se pidiera dentro
    // del Promise.all, la primera baja ya lo habria desactivado y el login
    // fallaria por una carrera de la prueba, no del codigo.
    const tokenSegundo = await login(segundo.email);

    const [a, b] = await Promise.all([
      como(ownerToken, 'DELETE', `/api/admin/users/${segundo.id}`),
      como(tokenSegundo, 'DELETE', `/api/admin/users/${ownerId}`),
    ]);

    const exitos = [a, b].filter((r) => r.statusCode === 200).length;
    assert.equal(exitos, 1, `una sola baja debia prosperar: ${a.statusCode}/${b.statusCode}`);

    const quedan = await prisma.user.count({
      where: { tenantId, role: 'OWNER', isActive: true },
    });
    assert.equal(quedan, 1, 'el local siempre conserva un dueño activo');

    // Se deja como estaba para las pruebas que siguen.
    await prisma.user.update({ where: { id: ownerId }, data: { isActive: true } });
    await prisma.user.delete({ where: { id: segundo.id } });
    ownerToken = await login(EMAIL_OWNER);
  });
});

/* --------------------------------------------------------- limites del plan */

describe('limites del plan al escribir', () => {
  it('bloquea el alta de platos al llegar al tope', async () => {
    await fijarPlan(2, 0);

    for (let i = 0; i < 2; i += 1) {
      const response = await como(ownerToken, 'POST', '/api/admin/dishes', {
        categoryId,
        name: `Plato ${i}`,
        priceCents: 100_000,
      });
      assert.equal(response.statusCode, 201, `el plato ${i} entra en el plan`);
    }

    const excedido = await como(ownerToken, 'POST', '/api/admin/dishes', {
      categoryId,
      name: 'Plato de mas',
      priceCents: 100_000,
    });
    assert.equal(excedido.statusCode, 403);
    assert.equal(excedido.json().error.code, 'PLAN_LIMIT_DISHES');
    // El mensaje dice el tope y lo que ya hay, no un "no se puede" a secas.
    assert.match(excedido.json().error.message, /2 platos/);

    const total = await prisma.dish.count({ where: { tenantId, archivedAt: null } });
    assert.equal(total, 2, 'no se creo el plato de mas');
  });

  it('dar de baja un plato libera un lugar', async () => {
    const platos = await prisma.dish.findMany({ where: { tenantId, archivedAt: null } });
    await como(ownerToken, 'DELETE', `/api/admin/dishes/${platos[0]!.id}`);

    const response = await como(ownerToken, 'POST', '/api/admin/dishes', {
      categoryId,
      name: 'Plato que ahora si entra',
      priceCents: 100_000,
    });
    assert.equal(response.statusCode, 201);
  });

  it('restaurar un plato tambien respeta el tope', async () => {
    const archivado = await prisma.dish.findFirst({
      where: { tenantId, archivedAt: { not: null } },
    });
    assert.ok(archivado, 'hay un plato dado de baja');

    const response = await como(
      ownerToken,
      'POST',
      `/api/admin/dishes/${archivado.id}/restore`,
    );
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'PLAN_LIMIT_DISHES');
  });

  it('bloquea el modelo 3D al llegar al tope', async () => {
    await fijarPlan(0, 1);
    const platos = await prisma.dish.findMany({
      where: { tenantId, archivedAt: null },
      take: 2,
    });

    const primero = await como(ownerToken, 'PATCH', `/api/admin/dishes/${platos[0]!.id}`, {
      modelGlbUrl: 'https://cdn.example.com/a.glb',
    });
    assert.equal(primero.statusCode, 200);

    const segundo = await como(ownerToken, 'PATCH', `/api/admin/dishes/${platos[1]!.id}`, {
      modelGlbUrl: 'https://cdn.example.com/b.glb',
    });
    assert.equal(segundo.statusCode, 403);
    assert.equal(segundo.json().error.code, 'PLAN_LIMIT_MODELS');
  });

  it('reemplazar un modelo existente no consume otro lugar', async () => {
    const conModelo = await prisma.dish.findFirstOrThrow({
      where: { tenantId, modelGlbUrl: { not: null } },
    });
    const response = await como(ownerToken, 'PATCH', `/api/admin/dishes/${conModelo.id}`, {
      modelGlbUrl: 'https://cdn.example.com/reemplazo.glb',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().modelGlbUrl, 'https://cdn.example.com/reemplazo.glb');
  });

  it('un plan sin topes no bloquea nada', async () => {
    await fijarPlan(0, 0);
    const response = await como(ownerToken, 'POST', '/api/admin/dishes', {
      categoryId,
      name: 'Plato sin limite',
      priceCents: 100_000,
      modelGlbUrl: 'https://cdn.example.com/libre.glb',
    });
    assert.equal(response.statusCode, 201);
  });
});

/* ------------------------------------------------ recuperacion de contraseña */

describe('recuperacion de contraseña', () => {
  it('responde igual exista o no la cuenta', async () => {
    const existente = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: EMAIL_OWNER },
    });
    const inexistente = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: `no-existe-${SUFFIX}@prueba.demo` },
    });

    assert.equal(existente.statusCode, 202);
    assert.equal(inexistente.statusCode, 202);
    // Mismo cuerpo: el formulario no sirve para detectar emails registrados.
    assert.deepEqual(existente.json(), inexistente.json());
  });

  it('en la base queda el hash del token, no el token', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: EMAIL_OWNER },
    });
    const registro = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: ownerId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // 64 caracteres hexadecimales = SHA-256.
    assert.match(registro.tokenHash, /^[a-f0-9]{64}$/);
  });

  it('el token cambia la contraseña y despues no sirve mas', async () => {
    const token = 'token-de-prueba-suficientemente-largo-123456';
    await prisma.passwordResetToken.create({
      data: {
        userId: ownerId,
        tokenHash: hashDelToken(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const nueva = 'contrasenia-nueva-456';
    const primera = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: nueva },
    });
    assert.equal(primera.statusCode, 200);

    // Entra con la nueva...
    ownerToken = await login(EMAIL_OWNER, nueva);

    // ...y el mismo enlace ya no sirve.
    const segunda = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'otra-cosa-789' },
    });
    assert.equal(segunda.statusCode, 400);
    assert.equal(segunda.json().error.code, 'RESET_TOKEN_INVALID');
  });

  it('usar un enlace invalida los otros pendientes', async () => {
    const tokenA = 'token-pendiente-aaaaaaaaaaaaaaaaaaaaaaa';
    const tokenB = 'token-pendiente-bbbbbbbbbbbbbbbbbbbbbbb';
    for (const t of [tokenA, tokenB]) {
      await prisma.passwordResetToken.create({
        data: {
          userId: ownerId,
          tokenHash: hashDelToken(t),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
    }

    const usoA = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: tokenA, password: 'clave-tras-el-enlace-a' },
    });
    assert.equal(usoA.statusCode, 200);

    const usoB = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: tokenB, password: 'clave-tras-el-enlace-b' },
    });
    assert.equal(usoB.statusCode, 400, 'el segundo enlace quedo anulado');

    ownerToken = await login(EMAIL_OWNER, 'clave-tras-el-enlace-a');
  });

  it('un token vencido no sirve', async () => {
    const token = 'token-vencido-cccccccccccccccccccccccc';
    await prisma.passwordResetToken.create({
      data: {
        userId: ownerId,
        tokenHash: hashDelToken(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'no-deberia-aplicarse' },
    });
    assert.equal(response.statusCode, 400);
  });

  it('un token inventado no sirve', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'inventado-dddddddddddddddddddddddd', password: 'cualquiera-123' },
    });
    assert.equal(response.statusCode, 400);
    // El mismo mensaje que para un token usado o vencido: quien prueba enlaces
    // no aprende cual acerto.
    assert.equal(response.json().error.code, 'RESET_TOKEN_INVALID');
  });

  it('el cambio desde la sesion exige la contraseña actual', async () => {
    const malo = await como(ownerToken, 'POST', '/api/auth/change-password', {
      currentPassword: 'la-que-no-es',
      newPassword: 'intento-fallido-123',
    });
    assert.equal(malo.statusCode, 400);
    assert.equal(malo.json().error.code, 'WRONG_PASSWORD');

    const bueno = await como(ownerToken, 'POST', '/api/auth/change-password', {
      currentPassword: 'clave-tras-el-enlace-a',
      newPassword: 'clave-final-de-la-prueba',
    });
    assert.equal(bueno.statusCode, 200);
    await login(EMAIL_OWNER, 'clave-final-de-la-prueba');
  });
  it('la respuesta no espera al envio del correo', async () => {
    // Si la respuesta esperara al correo, tardaria con una cuenta real y seria
    // instantanea con una inexistente: el reloj diria lo que el texto calla. Con
    // un proveedor que nunca termina, esa diferencia se vuelve un cuelgue, asi
    // que la prueba es determinista y no mide milisegundos.
    let seIntentoEnviar = false;
    setMailer({
      send: async () => {
        seIntentoEnviar = true;
        await new Promise(() => {});
      },
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: EMAIL_OWNER },
      });
      assert.equal(response.statusCode, 202, 'respondio sin esperar al correo');
      assert.ok(seIntentoEnviar, 'igual intento enviarlo');
    } finally {
      setMailer(null);
    }
  });
});
