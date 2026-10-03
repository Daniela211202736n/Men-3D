/**
 * Subida y entrega de assets (modelos 3D e imagenes).
 *
 * El backoffice siempre pide primero un *permiso de subida* y despues manda el
 * archivo a donde ese permiso indique. Con el driver `local` eso es un POST a
 * esta misma API; con `s3`, un PUT firmado directo al bucket, sin que el
 * archivo pase por el servidor. El frontend no necesita saber cual de los dos
 * esta configurado.
 *
 * La ruta publica es `/media/`, no `/assets/`: ese es el directorio por defecto
 * de los bundles de Vite y la colision hace que nginx proxee el JavaScript de
 * la PWA hacia la API.
 *
 * Seguridad de la entrega: el nombre lo genera el servidor y la ruta de lectura
 * solo acepta nombres que calcen exactamente con ese formato. No hay listado de
 * directorio ni se usa nada del nombre que mando el cliente, asi que no hay
 * superficie de path traversal.
 */
import type { FastifyInstance } from 'fastify';

import { badRequest, notFound } from '../../lib/errors.js';
import {
  ACCEPTED_UPLOADS,
  ASSET_KEY,
  CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  getStorage,
} from '../storage/index.js';

export default async function assetRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Pide permiso para subir un archivo. Responde a donde mandarlo, con que
   * cabeceras, y cual va a ser su URL publica definitiva.
   */
  app.post(
    '/api/admin/assets/upload-ticket',
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { contentType } = request.body as { contentType?: string };
      const accepted = ACCEPTED_UPLOADS[contentType as keyof typeof ACCEPTED_UPLOADS];
      if (!accepted) {
        throw badRequest(
          `Tipo no admitido: ${contentType ?? '(ninguno)'}. Se aceptan GLB, USDZ, PNG, JPG y WEBP.`,
        );
      }

      const storage = getStorage();
      const ticket = await storage.createUploadTicket({
        extension: accepted.ext,
        contentType: CONTENT_TYPES[accepted.ext] ?? contentType!,
      });
      return { ...ticket, maxBytes: MAX_UPLOAD_BYTES };
    },
  );

  /** Camino `direct`: el archivo llega a la API, que lo valida y lo guarda. */
  app.post('/upload', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) throw badRequest('No se recibio ningun archivo');

    const accepted = ACCEPTED_UPLOADS[file.mimetype as keyof typeof ACCEPTED_UPLOADS];
    if (!accepted) {
      throw badRequest(
        `Tipo no admitido: ${file.mimetype}. Se aceptan GLB, USDZ, PNG, JPG y WEBP.`,
      );
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength === 0) throw badRequest('El archivo esta vacio');

    // El mimetype lo declara el cliente: se verifica contra la firma real del
    // archivo para que un ejecutable renombrado no termine servido como modelo 3D.
    if (!buffer.subarray(0, accepted.magic.length).equals(accepted.magic)) {
      throw badRequest(
        `El contenido del archivo no coincide con un ${accepted.ext.toUpperCase()} valido`,
      );
    }

    const storage = getStorage();
    const contentType = CONTENT_TYPES[accepted.ext] ?? file.mimetype;
    const ticket = await storage.createUploadTicket({
      extension: accepted.ext,
      contentType,
    });
    await storage.save(ticket.key, buffer, contentType);

    return reply.status(201).send({
      name: ticket.key,
      url: ticket.publicUrl,
      bytes: buffer.byteLength,
      contentType,
    });
  });

  /**
   * Entrega un asset. Con el driver `s3` esta ruta practicamente no se usa: la
   * URL publica apunta al CDN y el navegador va directo.
   */
  app.get('/media/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!ASSET_KEY.test(name)) throw notFound('Asset');

    const object = await getStorage().read(name);
    if (!object) throw notFound('Asset');

    return reply
      .header('Content-Type', object.contentType)
      .header('Content-Length', object.size)
      // Inmutable: el nombre es un hash aleatorio, nunca se reutiliza.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(object.stream);
  });

  /** Estado del almacenamiento: dice que falta configurar, nunca que hay. */
  app.get(
    '/api/admin/assets/health',
    { preHandler: [app.requireAuth] },
    async () => getStorage().describeConfiguration(),
  );
}
