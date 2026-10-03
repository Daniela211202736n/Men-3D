/**
 * Almacenamiento de modelos 3D e imagenes, detras de una interfaz.
 *
 * Dos drivers:
 *
 *   `local` — guarda en disco y sirve desde la API. Cero infraestructura, ideal
 *             para desarrollo. En produccion es mala idea: cada GLB pasa por
 *             Node, y el disco del contenedor se borra al recrearlo.
 *
 *   `s3`    — sube a un bucket compatible con S3 (AWS, Cloudflare R2,
 *             DigitalOcean Spaces) y el CDN lo sirve directo al navegador.
 *
 * La diferencia importante no es donde queda el archivo sino **por donde viaja
 * al subirlo**: con `s3` el backoffice sube directo al bucket con una URL
 * firmada, asi un modelo de 20 MB no ocupa un proceso de la API durante toda la
 * transferencia. Por eso la interfaz no expone "subi este buffer" sino "dame un
 * permiso de subida", que cada driver resuelve como puede.
 */
import type { Readable } from 'node:stream';

/** Permiso de subida que el backoffice usa para mandar el archivo. */
export interface UploadTicket {
  /**
   * `direct`    — subir con un POST multipart a la propia API.
   * `presigned` — PUT directo al bucket con la URL firmada.
   */
  kind: 'direct' | 'presigned';
  /** A donde mandar el archivo. */
  uploadUrl: string;
  /** Cabeceras obligatorias del PUT firmado (vacio en `direct`). */
  headers: Record<string, string>;
  /** Nombre interno del objeto. */
  key: string;
  /** URL definitiva con la que se guarda y se sirve el asset. */
  publicUrl: string;
  /** Segundos que el permiso sigue siendo valido. */
  expiresInSeconds: number;
}

export interface StorageConfiguration {
  ready: boolean;
  missing: string[];
  details: Record<string, boolean | string>;
}

export interface StorageProvider {
  readonly name: 'local' | 's3';

  /** Emite el permiso de subida para un archivo nuevo. */
  createUploadTicket(input: {
    extension: string;
    contentType: string;
  }): Promise<UploadTicket>;

  /** Guarda el contenido. Solo lo usa el camino `direct`. */
  save(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Lee un objeto. Solo lo usa el camino `local`; con CDN no pasa por aca. */
  read(key: string): Promise<{ stream: Readable; size: number; contentType: string } | null>;

  /** Borra un objeto (al reemplazar el modelo de un plato). */
  remove(key: string): Promise<void>;

  publicUrlFor(key: string): string;

  describeConfiguration(): StorageConfiguration;
}

/** Tipos aceptados, con su extension y su firma binaria cuando la tiene. */
export const ACCEPTED_UPLOADS = {
  'model/gltf-binary': { ext: 'glb', magic: Buffer.from('glTF') },
  'application/octet-stream': { ext: 'glb', magic: Buffer.from('glTF') },
  'model/vnd.usdz+zip': { ext: 'usdz', magic: Buffer.from([0x50, 0x4b]) },
  'image/png': { ext: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { ext: 'jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  'image/webp': { ext: 'webp', magic: Buffer.from('RIFF') },
} as const;

export const CONTENT_TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Formato exacto de los nombres que genera el servidor: 32 hex + extension
 * conocida. La ruta de lectura solo acepta nombres que calcen con esto, asi que
 * no hay forma de pedir un archivo de fuera del almacenamiento.
 */
export const ASSET_KEY = /^[a-f0-9]{32}\.(glb|usdz|png|jpg|webp)$/;

/** 25 MB: un GLB de un plato bien optimizado pesa 1-3 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
