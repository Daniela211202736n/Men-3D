/**
 * Subida y entrega de assets (modelos 3D e imagenes).
 *
 * En produccion esto vive en un bucket + CDN (ver docs/ARCHITECTURE.md): un GLB
 * servido desde Node es la forma mas rapida de arruinar el tiempo de carga en
 * un celular con 4G. Este modulo existe para que el MVP funcione de punta a
 * punta sin cuenta de cloud.
 *
 * Seguridad de la entrega: el nombre de archivo lo genera el servidor
 * (`generateAssetName`) y la ruta de lectura solo acepta nombres que calcen
 * exactamente con ese formato. No hay listado de directorio ni se usa nada del
 * nombre que mando el cliente, asi que no hay superficie de path traversal.
 */
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { env } from '../../env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { generateAssetName } from '../../lib/ids.js';

/** Tipos aceptados, con su extension y su firma binaria cuando la tiene. */
const ACCEPTED = {
  'model/gltf-binary': { ext: 'glb', magic: Buffer.from('glTF') },
  'application/octet-stream': { ext: 'glb', magic: Buffer.from('glTF') },
  'model/vnd.usdz+zip': { ext: 'usdz', magic: Buffer.from([0x50, 0x4b]) },
  'image/png': { ext: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { ext: 'jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  'image/webp': { ext: 'webp', magic: Buffer.from('RIFF') },
} as const;

/** Formato exacto que produce `generateAssetName`: 32 hex + extension conocida. */
const ASSET_NAME = /^[a-f0-9]{32}\.(glb|usdz|png|jpg|webp)$/;

const CONTENT_TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** 25 MB: un GLB de un plato bien optimizado pesa 1-3 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

export default async function assetRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(env.STORAGE_DIR, { recursive: true });

  /** Sube un modelo o una imagen y devuelve su URL publica. */
  app.post(
    '/upload',
    { preHandler: [app.requireAuth] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: MAX_BYTES } });
      if (!file) throw badRequest('No se recibio ningun archivo');

      const accepted = ACCEPTED[file.mimetype as keyof typeof ACCEPTED];
      if (!accepted) {
        throw badRequest(
          `Tipo no admitido: ${file.mimetype}. Se aceptan GLB, USDZ, PNG, JPG y WEBP.`,
        );
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength === 0) throw badRequest('El archivo esta vacio');

      // El mimetype lo declara el cliente: se verifica contra la firma real del
      // archivo para que un .exe renombrado no termine servido como modelo 3D.
      if (!buffer.subarray(0, accepted.magic.length).equals(accepted.magic)) {
        throw badRequest(
          `El contenido del archivo no coincide con un ${accepted.ext.toUpperCase()} valido`,
        );
      }

      const name = generateAssetName(accepted.ext);
      await writeFile(join(env.STORAGE_DIR, name), buffer);

      return reply.status(201).send({
        name,
        url: `/assets/${name}`,
        bytes: buffer.byteLength,
        contentType: CONTENT_TYPES[accepted.ext],
      });
    },
  );

  /** Entrega un asset. Solo acepta nombres generados por nosotros. */
  app.get('/assets/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!ASSET_NAME.test(name)) throw notFound('Asset');

    const path = join(env.STORAGE_DIR, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) throw notFound('Asset');

      const ext = name.split('.').pop()!;
      return reply
        .header('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
        .header('Content-Length', info.size)
        // Inmutable: el nombre es un hash aleatorio, nunca se reutiliza.
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(path));
    } catch {
      throw notFound('Asset');
    }
  });
}
