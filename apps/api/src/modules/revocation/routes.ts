/**
 * El endpoint del boton de arrepentimiento.
 *
 * Publico y sin sesion, no por comodidad sino porque la Res. 424/2020 prohibe
 * exigirle al consumidor registrarse o hacer cualquier otro tramite para usar
 * el boton. Eso obliga a cuidar dos cosas que una ruta autenticada resuelve
 * sola:
 *
 *  - **Limite propio.** Es un formulario abierto que dispara dos correos, uno
 *    de ellos a una direccion que escribe quien lo usa: sin limite es un
 *    amplificador para inundar la casilla de un tercero. Mismo razonamiento que
 *    el del formulario de recuperacion de contraseña.
 *  - **Nada de enumeracion.** La respuesta no dice si el correo corresponde a
 *    una cuenta: no lo consulta. Un pedido de revocacion de alguien que no
 *    tiene cuenta es igual de valido —puede ser alguien a quien le cobraron sin
 *    haber contratado— y se registra igual.
 */
import rateLimit from '@fastify/rate-limit';
import { revocationRequestSchema } from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { env } from '../../env.js';
import { avisar, registrarPedido } from './service.js';

export default async function revocationRoutes(app: FastifyInstance): Promise<void> {
  // Cinco cada diez minutos por IP. A una persona que se arrepiente le sobra;
  // a quien quiera usar el formulario para mandar correo ajeno, no le alcanza.
  await app.register(rateLimit, {
    max: env.REVOCATION_RATE_LIMIT_MAX,
    timeWindow: '10 minutes',
  });

  app.post('/', async (request, reply) => {
    const input = revocationRequestSchema.parse(request.body);
    const registro = await registrarPedido(input);

    // El aviso no se espera: la persona ya se lleva el codigo en esta misma
    // respuesta —mismo medio, dentro del plazo— y el pedido ya quedo guardado.
    // Un proveedor de correo lento no tiene por que hacerla esperar, y si falla
    // no invalida nada: `notifiedAt` queda en null y se ve en la base.
    void avisar(registro, input);

    reply.code(201);
    return {
      code: registro.code,
      createdAt: registro.createdAt.toISOString(),
      mensaje:
        'Listo. Guardá este código: es el comprobante de que ejerciste tu ' +
        'derecho de arrepentimiento, con fecha de hoy. Te lo mandamos también ' +
        'por correo.',
    };
  });
}
