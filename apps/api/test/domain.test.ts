/**
 * Pruebas de las reglas que, si se rompen, cobran mal o dejan pasar un pedido
 * imposible. Son funciones puras: corren en milisegundos y sin base de datos.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOYALTY_POINTS,
  applyBps,
  computeOrderTotals,
  formatMoney,
} from '@men3d/shared';

import { parseEnumList, parseList, serializeList } from '../src/lib/lists.js';
import { generateOrderCode, slugify } from '../src/lib/ids.js';
import { canTransition } from '../src/modules/orders/service.js';
import { quoteRedemption } from '../src/modules/loyalty/service.js';
import { classifyCategory } from '../src/modules/ai/recommender.js';

describe('dinero', () => {
  it('suma las lineas y aplica el IVA sobre el neto', () => {
    const totals = computeOrderTotals(
      [
        { unitPriceCents: 1_450_000, quantity: 2 },
        { unitPriceCents: 650_000, quantity: 1 },
      ],
      { taxRateBps: 2100 },
    );
    assert.equal(totals.subtotalCents, 3_550_000);
    assert.equal(totals.taxCents, 745_500);
    assert.equal(totals.totalCents, 4_295_500);
  });

  it('calcula el IVA despues del descuento, no antes', () => {
    const totals = computeOrderTotals([{ unitPriceCents: 100_000, quantity: 1 }], {
      taxRateBps: 2100,
      discountCents: 50_000,
    });
    // 21 % de 50.000, no de 100.000.
    assert.equal(totals.taxCents, 10_500);
    assert.equal(totals.totalCents, 60_500);
  });

  it('nunca deja que el descuento supere el subtotal', () => {
    const totals = computeOrderTotals([{ unitPriceCents: 1000, quantity: 1 }], {
      discountCents: 999_999,
    });
    assert.equal(totals.discountCents, 1000);
    assert.equal(totals.totalCents, 0);
  });

  it('un carrito vacio da cero, no NaN', () => {
    const totals = computeOrderTotals([], { taxRateBps: 2100 });
    assert.deepEqual(totals, {
      subtotalCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });

  it('redondea el impuesto al centavo', () => {
    // 33 centavos al 21 % = 6,93 -> 7
    assert.equal(applyBps(33, 2100), 7);
  });

  it('formatea una moneda desconocida sin romper la vista', () => {
    assert.match(formatMoney(123_456, 'XYZ'), /XYZ/);
  });
});

describe('canje de puntos', () => {
  const rate = LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT;

  it('canjea solo multiplos exactos del ratio', () => {
    // 250 puntos con ratio 100 -> se usan 200 (2 unidades), no 250.
    const quote = quoteRedemption(250, 250, 1_000_000);
    assert.equal(quote.points % rate, 0);
    assert.equal(quote.points, 200);
    assert.equal(quote.discountCents, 200);
  });

  it('no canjea mas que el saldo disponible', () => {
    const quote = quoteRedemption(150, 10_000, 1_000_000);
    assert.ok(quote.points <= 150);
  });

  it('no canjea mas de lo que cubre el pedido', () => {
    // Pedido de 3 unidades monetarias: tope 300 puntos aunque haya 99.999.
    const quote = quoteRedemption(99_999, 99_999, 300);
    assert.equal(quote.discountCents, 300);
    assert.equal(quote.points, 3 * rate);
  });

  it('con saldo insuficiente no canjea nada', () => {
    const quote = quoteRedemption(50, 50, 1_000_000);
    assert.equal(quote.points, 0);
    assert.equal(quote.discountCents, 0);
  });

  it('ignora un pedido de canje negativo', () => {
    const quote = quoteRedemption(1000, -500, 1_000_000);
    assert.equal(quote.points, 0);
  });
});

describe('ciclo de vida del pedido', () => {
  it('permite el camino normal', () => {
    assert.ok(canTransition('PENDING_PAYMENT', 'PAID'));
    assert.ok(canTransition('PAID', 'IN_KITCHEN'));
    assert.ok(canTransition('IN_KITCHEN', 'READY'));
    assert.ok(canTransition('READY', 'SERVED'));
  });

  it('no deja retroceder un pedido', () => {
    assert.equal(canTransition('READY', 'PAID'), false);
    assert.equal(canTransition('SERVED', 'IN_KITCHEN'), false);
    assert.equal(canTransition('IN_KITCHEN', 'PENDING_PAYMENT'), false);
  });

  it('no deja saltear la cocina', () => {
    assert.equal(canTransition('PAID', 'READY'), false);
    assert.equal(canTransition('PAID', 'SERVED'), false);
  });

  it('los estados finales no transicionan', () => {
    assert.equal(canTransition('SERVED', 'CANCELED'), false);
    assert.equal(canTransition('CANCELED', 'PAID'), false);
  });

  it('se puede cancelar hasta que esta en cocina', () => {
    assert.ok(canTransition('PENDING_PAYMENT', 'CANCELED'));
    assert.ok(canTransition('PAID', 'CANCELED'));
    assert.ok(canTransition('IN_KITCHEN', 'CANCELED'));
    // Un pedido ya listo se entrega; cancelarlo es un reembolso, otro flujo.
    assert.equal(canTransition('READY', 'CANCELED'), false);
  });

  it('un estado desconocido no habilita nada', () => {
    assert.equal(canTransition('INVENTADO', 'PAID'), false);
  });
});

describe('listas portables', () => {
  it('va y vuelve sin perder nada', () => {
    const value = ['es', 'en', 'pt'];
    assert.deepEqual(parseList(serializeList(value)), value);
  });

  it('deduplica conservando el orden elegido', () => {
    assert.equal(serializeList(['en', 'es', 'en']), 'en,es');
  });

  it('tolera vacios, espacios y nulos', () => {
    assert.deepEqual(parseList(null), []);
    assert.deepEqual(parseList(''), []);
    assert.deepEqual(parseList(' es , , en '), ['es', 'en']);
    assert.equal(serializeList(undefined), '');
  });

  it('descarta valores fuera del vocabulario', () => {
    assert.deepEqual(parseEnumList('es,klingon,en', ['es', 'en'] as const), ['es', 'en']);
  });
});

describe('codigos y slugs', () => {
  it('el codigo de pedido no usa caracteres ambiguos', () => {
    for (let i = 0; i < 400; i += 1) {
      assert.doesNotMatch(generateOrderCode(), /[01OI]/);
    }
  });

  it('el codigo tiene el largo pedido', () => {
    assert.equal(generateOrderCode(4).length, 4);
    assert.equal(generateOrderCode(5).length, 5);
  });

  it('el slug saca tildes, eñes y simbolos', () => {
    assert.equal(slugify('La Parrilla de Don Pepe'), 'la-parrilla-de-don-pepe');
    assert.equal(slugify('  ¡Ñandú & Café!  '), 'nandu-cafe');
    assert.equal(slugify('a'.repeat(80)).length, 40);
  });
});

describe('clasificacion de categorias del recomendador', () => {
  it('reconoce bebidas en varios idiomas', () => {
    assert.equal(classifyCategory('Bebidas'), 'drink');
    assert.equal(classifyCategory('Vinos por copa'), 'drink');
    assert.equal(classifyCategory('Drinks & Cocktails'), 'drink');
  });

  it('reconoce postres y entradas', () => {
    assert.equal(classifyCategory('Postres'), 'dessert');
    assert.equal(classifyCategory('Entradas para compartir'), 'starter');
  });

  it('ignora tildes y mayusculas', () => {
    assert.equal(classifyCategory('CAFÉ'), 'drink');
  });

  it('lo que no reconoce queda como "other", no revienta', () => {
    assert.equal(classifyCategory('Sugerencias del chef'), 'other');
    assert.equal(classifyCategory(''), 'other');
  });
});
