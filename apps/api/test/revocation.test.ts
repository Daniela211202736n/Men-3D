/**
 * Boton de arrepentimiento (Res. 424/2020 SCI).
 *
 * Lo que importa probar no es que el formulario guarde una fila: es que se
 * cumplan las tres exigencias concretas de la resolucion, que son faciles de
 * romper sin darse cuenta.
 *
 *  - **Que no haga falta registrarse ni ningun otro tramite.** Sin token, sin
 *    cuenta, y con lo minimo: nombre y correo. El dia que alguien agregue un
 *    campo obligatorio mas, esta prueba lo frena.
 *  - **Que el codigo se informe en el acto.** La norma da 24 horas; dejarlo
 *    para un proceso posterior es la forma habitual de incumplirla. Viene en la
 *    misma respuesta.
 *  - **Que el correo salga igual**, y que si no sale, el pedido quede guardado
 *    de todas formas: alguien que ejerce un derecho no puede perderlo porque el
 *    proveedor de correo tuvo un mal dia.
 *
 * Mas el limite de peticiones, que en una ruta publica que dispara correo a una
 * direccion que escribe quien la usa no es una optimizacion: sin el, el
 * formulario es un amplificador para inundar la casilla de un tercero.
 *
 * **Cuidado al agregar pruebas acá:** el limite es de 5 peticiones cada diez
 * minutos y el contador vive en la instancia de la app. Las pruebas de este
 * bloque comparten una sola instancia, asi que entre todas no pueden pasar de
 * 4 peticiones. La del limite se construye su propia app por eso mismo.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { setMailer } from '../src/modules/mail/index.js';
import type { MailMessage, MailProvider } from '../src/modules/mail/provider.js';
import { prisma } from '../src/prisma.js';

const SUFFIX = Date.now();
const CORREO = `arrepentido-${SUFFIX}@prueba.demo`;

let app: FastifyInstance;
let enviados: MailMessage[] = [];

/** Proveedor de correo de mentira, para ver que sale y a donde. */
function mailerDePrueba(fallar = false): MailProvider {
  return {
    name: 'log',
    async send(message) {
      if (fallar) throw new Error('el proveedor de correo se cayo');
      enviados.push(message);
    },
    describeConfiguration() {
      return { ready: true, missing: [], details: {} };
    },
  };
}

async function esperarCorreos(cuantos: number, ms = 2000): Promise<void> {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (enviados.length >= cuantos) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

before(async () => {
  app = await buildApp();
  setMailer(mailerDePrueba());
});

after(async () => {
  await prisma.revocationRequest.deleteMany({ where: { email: { contains: String(SUFFIX) } } });
  setMailer(null);
  await app.close();
  await prisma.$disconnect();
});

describe('boton de arrepentimiento', () => {
  it('no pide cuenta ni mas que el nombre y el correo', async () => {
    enviados = [];
    // Sin cabecera de autorizacion a proposito: la norma prohibe exigir
    // registro. Y solo los dos campos minimos.
    const response = await app.inject({
      method: 'POST',
      url: '/api/arrepentimiento',
      payload: { name: 'Ana Arrepentida', email: CORREO },
    });

    assert.equal(response.statusCode, 201, response.body);
    const cuerpo = response.json() as { code: string; createdAt: string };

    // El codigo viene en el acto: la norma da 24 horas y esto son cero.
    assert.match(cuerpo.code, /^ARR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    assert.ok(!Number.isNaN(Date.parse(cuerpo.createdAt)));

    // Y quedo guardado, que es el registro de que ejercio el derecho.
    const fila = await prisma.revocationRequest.findUnique({ where: { code: cuerpo.code } });
    assert.equal(fila?.email, CORREO);
    assert.equal(fila?.name, 'Ana Arrepentida');

    // El correo con el codigo sale, y se registra que salio.
    await esperarCorreos(1);
    const alConsumidor = enviados.find((m) => m.to === CORREO);
    assert.ok(alConsumidor, 'no se le aviso al consumidor');
    assert.ok(
      alConsumidor.subject.includes(cuerpo.code) || alConsumidor.text.includes(cuerpo.code),
      'el correo no lleva el codigo',
    );

    const marcado = await prisma.revocationRequest.findUnique({
      where: { code: cuerpo.code },
      select: { notifiedAt: true },
    });
    assert.ok(marcado?.notifiedAt, 'no se registro el aviso');
  });

  it('un correo invalido no pasa', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/arrepentimiento',
      payload: { name: 'Beto', email: 'no-es-un-correo' },
    });
    // 422 y no 400: es lo que devuelve el manejador de errores de la app para
    // un fallo de validacion de zod, en toda la API.
    assert.equal(response.statusCode, 422);
  });

  it('si el correo falla, el pedido queda registrado igual', async () => {
    // Alguien que ejerce un derecho no lo pierde porque el proveedor de correo
    // tenga un mal dia. El codigo ademas ya lo vio en pantalla.
    setMailer(mailerDePrueba(true));
    const correo = `sin-aviso-${SUFFIX}@prueba.demo`;

    const response = await app.inject({
      method: 'POST',
      url: '/api/arrepentimiento',
      payload: { name: 'Caro', email: correo },
    });

    assert.equal(response.statusCode, 201, response.body);
    const { code } = response.json() as { code: string };

    const fila = await prisma.revocationRequest.findUnique({ where: { code } });
    assert.equal(fila?.email, correo);
    // Y se ve en la base que el aviso no salio.
    await new Promise((r) => setTimeout(r, 300));
    const marcado = await prisma.revocationRequest.findUnique({
      where: { code },
      select: { notifiedAt: true },
    });
    assert.equal(marcado?.notifiedAt, null);

    setMailer(mailerDePrueba());
  });

  it('el formulario no sirve para inundar de correo a un tercero', async () => {
    // App propia: el contador del limite vive en la instancia, y las pruebas de
    // arriba ya gastaron peticiones de la compartida.
    const suya = await buildApp();
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const response = await suya.inject({
          method: 'POST',
          url: '/api/arrepentimiento',
          payload: { name: 'Insistente', email: `tercero-${SUFFIX}@prueba.demo` },
        });
        codigos.push(response.statusCode);
      }
      assert.deepEqual(codigos.slice(0, 5), [201, 201, 201, 201, 201], codigos.join(','));
      assert.equal(codigos[5], 429, 'la sexta tendria que cortarse');
    } finally {
      await suya.close();
    }
  });
});
