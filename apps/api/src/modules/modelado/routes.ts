/**
 * "Sacale una foto al plato": las rutas del backoffice.
 *
 * Son cuatro y ninguna hace el trabajo pesado —eso esta en `service.ts`—, pero
 * las tres decisiones que las forman son suyas:
 *
 *  - **Detras de `PHOTO_TO_3D`.** Cada modelo generado se paga. Una cuenta del
 *    plan gratis con esto habilitado es una cuenta gratis que nos factura.
 *  - **Con su propio limite, mas duro que el general.** El limite global de la
 *    API esta pensado para que nadie la tumbe; este esta pensado para que nadie
 *    —ni un script, ni un dedo nervioso— gaste cien dolares en una tarde.
 *  - **El panel pregunta primero si esto existe.** Sin proveedor configurado la
 *    funcion no se ofrece: es mejor no mostrar el boton que mostrarlo y que
 *    falle. Subir un GLB hecho aparte sigue estando, y es el camino gratis.
 */
import type { FastifyInstance } from 'fastify';

import { env } from '../../env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import { modelado3dDisponible } from './index.js';
import {
  MAX_FOTO_BYTES,
  avanzar,
  crearTrabajo,
  ultimoTrabajo,
} from './service.js';

export default async function modeladoRoutes(app: FastifyInstance): Promise<void> {
  const gate = { preHandler: [app.requireFeature('PHOTO_TO_3D')] };

  /**
   * Si la funcion esta disponible en esta instalacion.
   *
   * No lleva el `gate`: el panel necesita poder preguntar aunque el plan no lo
   * incluya, para decir por que no aparece.
   */
  app.get('/modelado', async () => ({
    enabled: modelado3dDisponible(),
    provider: env.MODEL3D_PROVIDER,
    maxPhotoBytes: MAX_FOTO_BYTES,
  }));

  /** La foto, y a generar. */
  app.post(
    '/dishes/:id/modelo-desde-foto',
    {
      ...gate,
      config: {
        // 12 por hora y por IP. Un restaurante carga su carta en varias
        // sesiones, no de un saque, y esto cuesta plata en cada llamada.
        rateLimit: { max: 12, timeWindow: '1 hour' },
      },
    },
    async (request, reply) => {
      const { tenantId } = request.authUser!;
      const { id } = request.params as { id: string };

      if (!modelado3dDisponible()) {
        throw badRequest(
          'Esta instalacion no tiene configurado un generador de modelos 3D. ' +
            'Se puede subir el GLB a mano desde el editor del plato.',
          'MODEL3D_DISABLED',
        );
      }

      const archivo = await request.file({ limits: { fileSize: MAX_FOTO_BYTES } });
      if (!archivo) throw badRequest('No se recibio ninguna foto');

      const bytes = await archivo.toBuffer();
      const trabajo = await crearTrabajo(prisma, {
        tenantId,
        dishId: id,
        foto: { bytes, contentType: archivo.mimetype },
      });

      // 202 y no 201: el modelo todavia no existe. Lo que se creo es la
      // promesa de que va a existir, y el panel la sigue preguntando.
      return reply.code(202).send(trabajo);
    },
  );

  /** Como viene. Esta misma consulta es la que empuja el trabajo. */
  app.get('/model-jobs/:id', gate, async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    return await avanzar(prisma, tenantId, id);
  });

  /** El ultimo trabajo del plato, para retomar despues de recargar el panel. */
  app.get('/dishes/:id/model-job', gate, async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };

    const dish = await prisma.dish.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!dish) throw notFound('Plato');

    const trabajo = await ultimoTrabajo(prisma, tenantId, id);
    if (!trabajo) return null;
    // Se avanza de paso: si el dueño volvio diez minutos despues, lo que quiere
    // ver es el modelo, no "en curso, 40%".
    return trabajo.status === 'READY' || trabajo.status === 'FAILED'
      ? trabajo
      : await avanzar(prisma, tenantId, trabajo.id);
  });
}
