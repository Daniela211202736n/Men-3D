/**
 * Ver y borrar los datos del comensal.
 *
 * Va bajo `/api/public/:slug` porque el comensal no tiene sesion: lo unico que
 * lo identifica es el `guestId` de su navegador, que viaja en la peticion.
 *
 * Eso tiene una consecuencia que conviene tener presente: **quien conozca un
 * `guestId` puede ver y borrar los datos de ese dispositivo.** Es el mismo
 * nivel de proteccion que ya tiene el saldo de puntos, y el id es un valor al
 * azar de 24 caracteres que solo existe en ese navegador —no se manda por
 * correo, no aparece en una URL compartible ni en el ticket. Aun asi, estas
 * rutas llevan un limite mas estricto que el resto de la carta: adivinar ids
 * al azar tiene que salir caro, y borrar es irreversible.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import { badRequest } from '../../lib/errors.js';
import { tenantOf } from '../../plugins/tenant.js';
import { borrarDatos, exportarDatos } from './service.js';

/** Forma de los ids que genera el frontend: `g-` y 24 hex. */
const FORMA_DEL_ID = /^g-[0-9a-f]{24}$/;

function leerGuestId(valor: unknown): string {
  if (typeof valor !== 'string' || !FORMA_DEL_ID.test(valor)) {
    throw badRequest('Falta el identificador de tu dispositivo', 'GUEST_ID_INVALIDO');
  }
  return valor;
}

export default async function privacyRoutes(app: FastifyInstance): Promise<void> {
  // Como el resto del grupo publico: el restaurante sale del slug de la URL.
  app.addHook('preHandler', app.resolveTenant);

  // Mas estricto que el resto de la carta: son datos personales y un borrado
  // no se deshace.
  await app.register(rateLimit, { max: 20, timeWindow: '10 minutes' });

  /** Todo lo que el restaurante tiene de este dispositivo. */
  app.get('/privacy/data', async (request) => {
    const tenant = tenantOf(request);
    const { guestId } = request.query as { guestId?: string };
    return exportarDatos(tenant.id, tenant.slug, leerGuestId(guestId));
  });

  /**
   * Borrado. Los pedidos se anonimizan en vez de borrarse: son comprobantes de
   * venta que el restaurante esta obligado a conservar. Ver el servicio.
   */
  app.delete('/privacy/data', async (request) => {
    const tenant = tenantOf(request);
    const { guestId } = request.query as { guestId?: string };
    const resultado = await borrarDatos(tenant.id, leerGuestId(guestId));

    return {
      ...resultado,
      mensaje:
        'Listo. Tus opiniones y tus puntos se borraron. Tus pedidos quedan sin ' +
        'ningun dato tuyo: el restaurante conserva el comprobante de la venta, ' +
        'que esta obligado a guardar, pero ya no te señala.',
    };
  });
}
