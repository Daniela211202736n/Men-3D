/**
 * Cobro de la configuracion inicial.
 *
 * Es el importe mas grande del modelo, asi que lo que hay que probar es lo que
 * impide que alguien se lo lleve gratis:
 *
 *  - Un cobro de un peso con nuestra referencia externa NO marca nada. Sin esa
 *    comprobacion, bastaria con armar un pago chico para llevarse el setup.
 *  - Un cobro que no esta aprobado tampoco.
 *  - Un cobro de otro restaurante no toca a este.
 *  - Un aviso repetido no hace nada dos veces.
 *  - Y sin firma, el webhook no aplica nada.
 *
 * El dialogo real con MercadoPago necesita una cuenta y esta anotado en
 * ROADMAP.md; lo que se prueba aca es la logica que decide.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import {
  aplicarCobroDeSetup,
  referenciaDeSetup,
  tenantDeLaReferencia,
  type CobroConsultado,
} from '../src/modules/billing/setup-fee.js';

const SUFFIX = Date.now();
const SLUG = `setup-${SUFFIX}`;
const EMAIL = `dueno-setup-${SUFFIX}@prueba.demo`;
const PASSWORD = 'clave-de-prueba-123';
/** El plan PRO del seed: lo que el cobro tiene que igualar. */
let setupFeeCents = 0;

let app: FastifyInstance;
let tenantId: string;
let subscriptionId: string;

function cobro(parcial: Partial<CobroConsultado> = {}): CobroConsultado {
  return {
    tenantId,
    aprobado: true,
    montoCents: setupFeeCents,
    providerRef: `pago-${Date.now()}`,
    estado: 'approved',
    ...parcial,
  };
}

before(async () => {
  app = await buildApp();
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Setup', defaultLocale: 'es' },
  });
  tenantId = tenant.id;

  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: 'PRO' } });
  setupFeeCents = plan.setupFeeCents;
  assert.ok(setupFeeCents > 0, 'el plan de prueba tiene que tener setup fee');

  const sub = await prisma.subscription.create({
    data: { tenantId, planId: plan.id, status: 'ACTIVE' },
  });
  subscriptionId = sub.id;

  await prisma.user.create({
    data: {
      tenantId,
      email: EMAIL,
      name: 'Dueño',
      role: 'OWNER',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
});

beforeEach(async () => {
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { setupFeePaid: false },
  });
});

after(async () => {
  await prisma.billingEvent.deleteMany({ where: { subscriptionId } });
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

async function estaPago(): Promise<boolean> {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  return sub.setupFeePaid;
}

describe('la referencia externa', () => {
  it('distingue un setup de un pedido', () => {
    // El webhook de pedidos busca un Order por la referencia: si no se
    // distinguieran, un cobro caeria en el lado equivocado.
    const ref = referenciaDeSetup(tenantId);
    assert.equal(tenantDeLaReferencia(ref), tenantId);
    assert.equal(tenantDeLaReferencia('cmxyz123'), null, 'un id de pedido no es un setup');
    assert.equal(tenantDeLaReferencia(undefined), null);
  });
});

describe('que marca la configuracion como paga', () => {
  it('el cobro por el importe correcto, aprobado', async () => {
    const r = await aplicarCobroDeSetup(cobro());
    assert.deepEqual(r, { aplicado: true, yaEstaba: false });
    assert.equal(await estaPago(), true);
  });

  it('un cobro de un peso NO alcanza', async () => {
    // Lo que separa cobrar de regalar.
    const r = await aplicarCobroDeSetup(cobro({ montoCents: 100 }));
    assert.deepEqual(r, { aplicado: false, motivo: 'importe-no-coincide' });
    assert.equal(await estaPago(), false, 'se marco pago con un importe menor');
  });

  it('un cobro sin importe tampoco', async () => {
    const r = await aplicarCobroDeSetup(cobro({ montoCents: null }));
    assert.deepEqual(r, { aplicado: false, motivo: 'importe-no-coincide' });
    assert.equal(await estaPago(), false);
  });

  it('un cobro pendiente no es un cobro', async () => {
    const r = await aplicarCobroDeSetup(cobro({ aprobado: false, estado: 'pending' }));
    assert.deepEqual(r, { aplicado: false, motivo: 'no-aprobado' });
    assert.equal(await estaPago(), false);
  });

  it('pagar de mas se acepta', async () => {
    // Propina o redondeo del lado de la pasarela: no es motivo para negarle el
    // servicio a alguien que pago.
    const r = await aplicarCobroDeSetup(cobro({ montoCents: setupFeeCents + 500 }));
    assert.equal(r.aplicado, true);
  });

  it('aplicar dos veces no rompe', async () => {
    await aplicarCobroDeSetup(cobro());
    const segundo = await aplicarCobroDeSetup(cobro());
    assert.deepEqual(segundo, { aplicado: true, yaEstaba: true });
  });

  it('un restaurante que no existe no se inventa', async () => {
    const r = await aplicarCobroDeSetup(cobro({ tenantId: 'no-existe' }));
    assert.deepEqual(r, { aplicado: false, motivo: 'sin-suscripcion' });
  });
});

describe('la ruta del backoffice', () => {
  async function token(): Promise<string> {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().token as string;
  }

  it('no deja pagar dos veces lo mismo', async () => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { setupFeePaid: true },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/admin/subscription/setup-fee',
      headers: { authorization: `Bearer ${await token()}` },
    });
    assert.equal(r.statusCode, 409, r.body);
  });
});

describe('el webhook no se cree cualquier cosa', () => {
  it('sin firma valida no aplica nada', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook/mercadopago/setup',
      payload: { type: 'payment', data: { id: 'inventado' } },
    });
    assert.equal(r.statusCode, 401, r.body);
    assert.equal(await estaPago(), false);
  });

  it('un aviso que no es de un cobro se reconoce y se descarta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook/mercadopago/setup',
      payload: { type: 'merchant_order', data: { id: 'x' } },
    });
    // 200 para que MercadoPago no reintente durante horas por algo que no nos
    // mueve nada.
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().applied, false);
  });
});
