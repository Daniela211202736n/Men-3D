/**
 * Driver `local`: disco del servidor, servido por la propia API.
 *
 * Sirve para desarrollo y para una demo. No para produccion: ver provider.ts.
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { env } from '../../env.js';
import { generateAssetName } from '../../lib/ids.js';
import {
  ASSET_KEY,
  CONTENT_TYPES,
  type StorageConfiguration,
  type StorageProvider,
  type UploadTicket,
} from './provider.js';

export class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;

  async createUploadTicket(input: { extension: string }): Promise<UploadTicket> {
    const key = generateAssetName(input.extension);
    return {
      kind: 'direct',
      // El backoffice sube con un POST multipart a la API, que valida la firma
      // binaria del archivo antes de guardarlo.
      uploadUrl: '/upload',
      headers: {},
      key,
      publicUrl: this.publicUrlFor(key),
      expiresInSeconds: 600,
    };
  }

  async save(key: string, body: Buffer): Promise<void> {
    // `key` siempre lo genera el servidor, pero se vuelve a comprobar aca: es
    // la ultima linea antes de tocar el disco.
    if (!ASSET_KEY.test(key)) throw new Error(`Nombre de asset invalido: ${key}`);
    await mkdir(env.STORAGE_DIR, { recursive: true });
    await writeFile(join(env.STORAGE_DIR, key), body);
  }

  async read(key: string) {
    if (!ASSET_KEY.test(key)) return null;
    const path = join(env.STORAGE_DIR, key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const ext = key.split('.').pop()!;
      return {
        stream: createReadStream(path),
        size: info.size,
        contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    if (!ASSET_KEY.test(key)) return;
    await rm(join(env.STORAGE_DIR, key), { force: true });
  }

  publicUrlFor(key: string): string {
    return `/media/${key}`;
  }

  describeConfiguration(): StorageConfiguration {
    return {
      ready: true,
      missing: [],
      details: { driver: 'local', directory: env.STORAGE_DIR, servedByApi: true },
    };
  }
}
