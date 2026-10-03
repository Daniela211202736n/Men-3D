/**
 * Pruebas del adaptador de MercadoPago.
 *
 * Se concentran en lo que, si falla, cobra mal o deja entrar una notificacion
 * falsa: la verificacion de firma, la conversion entre centavos y pesos, y la
 * traduccion de estados.
 */
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  amountToCents,
  buildSignatureManifest,
  centsToAmount,
  extractDataId,
  extractNotificationType,
  mapPaymentStatus,
  parseSignatureHeader,
  verifySignature,
} from '../src/modules/payments/mercadopago.js';

const SECRET = 'un-secreto-de-webhook-de-prueba';

/** Arma una cabecera x-signature valida, como la mandaria MercadoPago. */
function signedHeader(input: {
  dataId: string;
  requestId?: string;
  ts: number;
  secret?: string;
}): string {
  const manifest = buildSignatureManifest({
    dataId: input.dataId,
    requestId: input.requestId,
    ts: String(input.ts),
  });
  const v1 = createHmac('sha256', input.secret ?? SECRET).update(manifest).digest('hex');
  return `ts=${input.ts},v1=${v1}`;
}

describe('conversion de importes', () => {
  it('pasa de centavos a pesos y vuelve sin perder nada', () => {
    for (const cents of [0, 1, 99, 100, 12_345, 1_450_000, 4_295_500]) {
      assert.equal(amountToCents(centsToAmount(cents)), cents);
    }
  });

  it('no arrastra el error del punto flotante', () => {
    // 123.45 * 100 da 12344.999999999998 en coma flotante.
    assert.equal(amountToCents(123.45), 12_345);
    assert.equal(amountToCents(0.07), 7);
    assert.equal(amountToCents(1019.99), 101_999);
  });

  it('expresa los centavos con dos decimales', () => {
    assert.equal(centsToAmount(1_450_000), 14_500);
    assert.equal(centsToAmount(7), 0.07);
  });
});

describe('mapeo de estados', () => {
  it('solo "approved" cuenta como cobrado', () => {
    assert.equal(mapPaymentStatus('approved'), 'SUCCEEDED');
  });

  it('lo pendiente no se da por cobrado', () => {
    // Un pago en efectivo puede tardar horas: la cocina no arranca por esto.
    for (const status of ['pending', 'in_process', 'authorized', 'in_mediation']) {
      assert.equal(mapPaymentStatus(status), 'PROCESSING');
    }
  });

  it('reconoce rechazos y devoluciones', () => {
    assert.equal(mapPaymentStatus('rejected'), 'FAILED');
    assert.equal(mapPaymentStatus('cancelled'), 'FAILED');
    assert.equal(mapPaymentStatus('refunded'), 'REFUNDED');
    assert.equal(mapPaymentStatus('charged_back'), 'REFUNDED');
  });

  it('un estado desconocido nunca se interpreta como cobrado', () => {
    assert.equal(mapPaymentStatus('estado_nuevo_de_mercadopago'), 'PROCESSING');
    assert.equal(mapPaymentStatus(undefined), 'PROCESSING');
  });
});

describe('cabecera x-signature', () => {
  it('extrae ts y v1', () => {
    assert.deepEqual(parseSignatureHeader('ts=1704908010,v1=abc123'), {
      ts: '1704908010',
      v1: 'abc123',
    });
  });

  it('tolera espacios y orden invertido', () => {
    assert.deepEqual(parseSignatureHeader(' v1=abc123 , ts=170 '), {
      ts: '170',
      v1: 'abc123',
    });
  });

  it('devuelve null si falta alguna parte', () => {
    assert.equal(parseSignatureHeader('ts=123'), null);
    assert.equal(parseSignatureHeader('v1=abc'), null);
    assert.equal(parseSignatureHeader(''), null);
    assert.equal(parseSignatureHeader(undefined), null);
  });
});

describe('manifiesto de la firma', () => {
  it('sigue el formato id;request-id;ts', () => {
    assert.equal(
      buildSignatureManifest({ dataId: '123', requestId: 'req-1', ts: '170' }),
      'id:123;request-id:req-1;ts:170;',
    );
  });

  it('pasa el id a minusculas', () => {
    // MercadoPago firma el id en minusculas; respetarlo evita rechazar firmas
    // legitimas cuando el id trae letras.
    assert.equal(
      buildSignatureManifest({ dataId: 'AbC-123', requestId: 'r', ts: '1' }),
      'id:abc-123;request-id:r;ts:1;',
    );
  });

  it('omite el par entero cuando falta el valor', () => {
    assert.equal(
      buildSignatureManifest({ dataId: undefined, requestId: 'r', ts: '1' }),
      'request-id:r;ts:1;',
    );
    assert.equal(
      buildSignatureManifest({ dataId: '5', requestId: undefined, ts: '1' }),
      'id:5;ts:1;',
    );
  });
});

describe('verificacion de firma', () => {
  const ahora = 1_800_000_000;

  it('acepta una notificacion legitima', () => {
    const header = signedHeader({ dataId: '12345', requestId: 'req-abc', ts: ahora });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'req-abc',
      dataId: '12345',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, true);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    const header = signedHeader({
      dataId: '12345',
      requestId: 'req-abc',
      ts: ahora,
      secret: 'secreto-del-atacante',
    });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'req-abc',
      dataId: '12345',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
  });

  it('rechaza si cambiaron el id del cobro', () => {
    const header = signedHeader({ dataId: '12345', requestId: 'req-abc', ts: ahora });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'req-abc',
      // El atacante apunta a otro cobro reutilizando una firma valida.
      dataId: '99999',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
  });

  it('rechaza una notificacion vieja reenviada', () => {
    const header = signedHeader({ dataId: '12345', requestId: 'r', ts: ahora - 7200 });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'r',
      dataId: '12345',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
    assert.match(check.reason ?? '', /tolerancia/);
  });

  it('acepta una diferencia de reloj pequeña', () => {
    const header = signedHeader({ dataId: '12345', requestId: 'r', ts: ahora + 120 });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'r',
      dataId: '12345',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, true);
  });

  it('verifica igual cuando no viene x-request-id', () => {
    const header = signedHeader({ dataId: '12345', ts: ahora });
    const check = verifySignature({
      signatureHeader: header,
      requestId: undefined,
      dataId: '12345',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, true);
  });

  it('acepta el id en mayusculas si la firma se hizo en minusculas', () => {
    const header = signedHeader({ dataId: 'abc-99', requestId: 'r', ts: ahora });
    const check = verifySignature({
      signatureHeader: header,
      requestId: 'r',
      dataId: 'ABC-99',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, true);
  });

  it('rechaza sin cabecera y sin lanzar', () => {
    const check = verifySignature({
      signatureHeader: undefined,
      requestId: 'r',
      dataId: '1',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
  });

  it('rechaza una firma de largo distinto sin romper', () => {
    // timingSafeEqual lanza si los buffers no miden igual: hay que compararlo antes.
    const check = verifySignature({
      signatureHeader: `ts=${ahora},v1=corta`,
      requestId: 'r',
      dataId: '1',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
  });

  it('rechaza un timestamp que no es un numero', () => {
    const check = verifySignature({
      signatureHeader: 'ts=ayer,v1=abc',
      requestId: 'r',
      dataId: '1',
      secret: SECRET,
      nowSeconds: ahora,
    });
    assert.equal(check.valid, false);
  });
});

describe('lectura de la notificacion', () => {
  const vacio = { headers: {}, query: {} };

  it('toma data.id del cuerpo', () => {
    assert.equal(
      extractDataId({ ...vacio, body: { type: 'payment', data: { id: '123' } } }),
      '123',
    );
  });

  it('acepta un id numerico', () => {
    assert.equal(extractDataId({ ...vacio, body: { data: { id: 456 } } }), '456');
  });

  it('cae a la query cuando el cuerpo no lo trae', () => {
    assert.equal(
      extractDataId({ body: {}, headers: {}, query: { 'data.id': '789' } }),
      '789',
    );
  });

  it('soporta el formato viejo con topic e id en la query', () => {
    const request = { body: null, headers: {}, query: { topic: 'payment', id: '42' } };
    assert.equal(extractDataId(request), '42');
    assert.equal(extractNotificationType(request), 'payment');
  });

  it('devuelve undefined si no hay id por ningun lado', () => {
    assert.equal(extractDataId({ ...vacio, body: { type: 'payment' } }), undefined);
  });

  it('distingue el tipo de notificacion', () => {
    assert.equal(
      extractNotificationType({ ...vacio, body: { type: 'merchant_order' } }),
      'merchant_order',
    );
  });
});
