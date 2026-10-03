/**
 * Correo de confirmacion del pedido.
 *
 * Lo que importa probar:
 *
 *  - Que salga por los **dos** caminos que llevan a pagado: el cobro inmediato
 *    y el aviso de la pasarela. Es facil enganchar uno y olvidarse del otro, y
 *    el olvido no se nota: el pedido entra igual.
 *  - Que **no** salga si el comensal no dejo email. Comer en el local sin
 *    dejar correo es lo normal, no un error.
 *  - Que vaya en el idioma en el que pidio. Mandar el correo en español a
 *    quien recorrio la carta en ingles tira por la borda la traduccion justo
 *    en el ultimo paso.
 *  - Que un fallo del correo no rompa el pedido. El pedido ya esta pagado y la
 *    cocina ya lo recibio: eso no se deshace porque el correo falle.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { setMailer } from '../src/modules/mail/index.js';
import type { MailMessage } from '../src/modules/mail/provider.js';
import { armarConfirmacion } from '../src/modules/orders/confirmation-mail.js';
import { applyPaymentUpdate } from '../src/modules/orders/service.js';

const SUFFIX = Date.now();
const SLUG = `correo-${SUFFIX}`;

let app: FastifyInstance;
let tenantId: string;
let dishId: string;

/** Correos capturados, con una espera: el envio va sin `await` a proposito. */
let enviados: MailMessage[] = [];

async function esperarCorreo(ms = 1500): Promise<MailMessage | null> {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (enviados.length > 0) return enviados[0]!;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

before(async () => {
  app = await buildApp();
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'El Correo', defaultLocale: 'es', currency: 'ARS' },
  });
  tenantId = tenant.id;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: 'PRO' } });
  await prisma.subscription.create({ data: { tenantId, planId: plan.id, status: 'ACTIVE' } });

  const categoria = await prisma.category.create({
    data: { tenantId, name: 'Unica', position: 0 },
  });
  const plato = await prisma.dish.create({
    data: { tenantId, categoryId: categoria.id, name: 'Milanesa', priceCents: 100_000 },
  });
  dishId = plato.id;
});

beforeEach(() => {
  enviados = [];
  setMailer({
    name: 'log',
    send: async (m) => {
      enviados.push(m);
    },
    describeConfiguration: () => ({ ready: true, missing: [], details: {} }),
  });
});

after(async () => {
  setMailer(null);
  await deleteTenantsBySlug([SLUG]);
  await app.close();
  await prisma.$disconnect();
});

function pedir(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/public/${SLUG}/orders`,
    payload: { items: [{ dishId, quantity: 2 }], ...body },
  });
}

describe('cuando se paga en el momento', () => {
  it('manda la confirmacion', async () => {
    const r = await pedir({ customerEmail: 'comensal@prueba.demo', customerName: 'Ana' });
    assert.equal(r.statusCode, 201, r.body);

    const correo = await esperarCorreo();
    assert.ok(correo, 'no se mando ningun correo');
    assert.equal(correo.to, 'comensal@prueba.demo');
    assert.match(correo.subject, /Tu pedido [A-Z0-9-]+/);
    // Lo que el comensal necesita: que pidio, cuanto y donde seguirlo.
    assert.match(correo.text, /Milanesa/);
    assert.match(correo.text, /\/pedido\//, 'falta el enlace de seguimiento');
    assert.match(correo.text, /Ana/);
  });

  it('sin email no manda nada', async () => {
    // No es un error: comer en el local sin dejar correo es lo normal.
    const r = await pedir({ customerName: 'Sin correo' });
    assert.equal(r.statusCode, 201);
    assert.equal(await esperarCorreo(400), null, 'mando un correo sin destinatario');
  });

  it('va en el idioma en que pidio', async () => {
    await pedir({ customerEmail: 'diner@prueba.demo', locale: 'en' });
    const correo = await esperarCorreo();
    assert.ok(correo);
    assert.match(correo.subject, /Your order/);
    assert.match(correo.text, /Follow your order live/);
  });

  it('un fallo del correo no rompe el pedido', async () => {
    // El pedido ya esta pagado y la cocina ya lo recibio: eso no se deshace.
    setMailer({
      name: 'log',
      send: async () => {
        throw new Error('el proveedor esta caido');
      },
      describeConfiguration: () => ({ ready: true, missing: [], details: {} }),
    });

    const r = await pedir({ customerEmail: 'comensal@prueba.demo' });
    assert.equal(r.statusCode, 201, 'el pedido fallo porque fallo el correo');

    const pedido = await prisma.order.findFirstOrThrow({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(pedido.status, 'PAID');
  });
});

describe('el cuerpo del correo', () => {
  const base = {
    id: 'x',
    code: 'ABC1',
    customerEmail: 'a@b.com',
    customerName: 'Ana',
    tableLabel: '4',
    totalCents: 242_000,
    pointsEarned: 24,
    locale: 'es',
    items: [{ nameSnapshot: 'Milanesa', quantity: 2, unitPriceCents: 100_000 }],
  } as never;

  it('sin email no arma nada', () => {
    const sinCorreo = { ...(base as object), customerEmail: null } as never;
    assert.equal(
      armarConfirmacion({ order: sinCorreo, nombreDelLocal: 'X', slug: 's', currency: 'ARS' }),
      null,
    );
  });

  it('muestra la mesa y los puntos cuando los hay', () => {
    const m = armarConfirmacion({
      order: base,
      nombreDelLocal: 'El Correo',
      slug: SLUG,
      currency: 'ARS',
    });
    assert.ok(m);
    assert.match(m.text, /Mesa 4/);
    assert.match(m.text, /24 puntos/);
    assert.match(m.text, /El Correo/);
  });

  it('un idioma sin texto propio cae al ingles, no al español', () => {
    // Para quien no habla ninguno de los tres, el ingles es la eleccion que
    // mas gente entiende.
    const enFrances = { ...(base as object), locale: 'fr' } as never;
    const m = armarConfirmacion({
      order: enFrances,
      nombreDelLocal: 'X',
      slug: 's',
      currency: 'ARS',
    });
    assert.ok(m);
    assert.match(m.subject, /Your order/);
  });
});

describe('cuando el pago entra por el webhook', () => {
  it('tambien manda la confirmacion', async () => {
    // Es el camino que se olvida: el pedido entra igual, y el olvido no se
    // nota hasta que un cliente pregunta por que no le llego nada.
    const pedido = await prisma.order.create({
      data: {
        tenantId,
        code: `WH${SUFFIX}`.slice(0, 12),
        status: 'PENDING_PAYMENT',
        customerEmail: 'webhook@prueba.demo',
        customerName: 'Pago diferido',
        locale: 'es',
        subtotalCents: 200_000,
        taxCents: 42_000,
        totalCents: 242_000,
        items: {
          create: [
            {
              dishId,
              nameSnapshot: 'Milanesa',
              quantity: 2,
              unitPriceCents: 100_000,
            },
          ],
        },
      },
    });

    const resultado = await applyPaymentUpdate({
      orderId: pedido.id,
      providerRef: 'pago-del-webhook',
      provider: 'mercadopago',
      status: 'SUCCEEDED',
      amountCents: 242_000,
      raw: { status: 'approved' },
    });
    assert.equal(resultado.outcome, 'settled');

    const correo = await esperarCorreo();
    assert.ok(correo, 'el pago entro por el webhook y no se mando nada');
    assert.equal(correo.to, 'webhook@prueba.demo');
    assert.match(correo.text, /Milanesa/);
  });
});
