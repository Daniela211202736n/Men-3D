/**
 * Driver `s3`: bucket compatible con S3 (AWS, Cloudflare R2, DigitalOcean
 * Spaces, MinIO) con el CDN delante.
 *
 * La subida va directo del navegador al bucket con una URL firmada. El archivo
 * nunca pasa por la API, que es lo que permite subir un modelo de 20 MB sin
 * ocupar un proceso del servidor durante toda la transferencia.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import { env } from '../../env.js';
import { generateAssetName } from '../../lib/ids.js';
import {
  ASSET_KEY,
  CONTENT_TYPES,
  type StorageConfiguration,
  type StorageProvider,
  type UploadTicket,
} from './provider.js';

/** Minutos que vive la URL firmada de subida. */
const UPLOAD_TTL_SECONDS = 10 * 60;

/**
 * Un año de cache. Es seguro porque el nombre del objeto es un hash aleatorio
 * que nunca se reutiliza: si el plato cambia de modelo, cambia la URL.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Todo lo que el driver necesita saber del bucket. */
export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Endpoint propio de R2/Spaces/MinIO. Vacio = AWS S3. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Dominio del CDN. Vacio = se sirve desde el bucket. */
  cdnPublicUrl?: string;
}

/** La configuracion que sale del entorno, que es la de produccion. */
export function s3ConfigFromEnv(): S3StorageConfig {
  return {
    bucket: env.S3_BUCKET ?? '',
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    cdnPublicUrl: env.CDN_PUBLIC_URL,
  };
}

export class S3Storage implements StorageProvider {
  readonly name = 's3' as const;

  private readonly config: S3StorageConfig;
  private client: S3Client | null = null;

  /**
   * La configuracion se recibe, no se lee de una variable global. Por defecto
   * sale del entorno; pasarla explicita permite apuntar el driver a otro bucket
   * —o a uno de prueba— sin tocar el entorno del proceso.
   */
  constructor(config?: Partial<S3StorageConfig>) {
    this.config = { ...s3ConfigFromEnv(), ...config };
  }

  private getClient(): S3Client {
    this.client ??= new S3Client({
      region: this.config.region,
      ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
      // R2, Spaces y MinIO no resuelven el bucket por subdominio.
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
    return this.client;
  }

  private get bucket(): string {
    if (!this.config.bucket) throw new Error('Falta S3_BUCKET');
    return this.config.bucket;
  }

  async createUploadTicket(input: {
    extension: string;
    contentType: string;
  }): Promise<UploadTicket> {
    const key = generateAssetName(input.extension);

    const uploadUrl = await getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: input.contentType,
        CacheControl: CACHE_CONTROL,
      }),
      { expiresIn: UPLOAD_TTL_SECONDS },
    );

    return {
      kind: 'presigned',
      uploadUrl,
      // La firma cubre estas cabeceras: si el navegador manda otras, el bucket
      // rechaza la subida.
      headers: { 'Content-Type': input.contentType, 'Cache-Control': CACHE_CONTROL },
      key,
      publicUrl: this.publicUrlFor(key),
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    };
  }

  async save(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!ASSET_KEY.test(key)) throw new Error(`Nombre de asset invalido: ${key}`);
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      }),
    );
  }

  async read(key: string) {
    if (!ASSET_KEY.test(key)) return null;
    try {
      const result = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      const ext = key.split('.').pop()!;
      return {
        stream: result.Body as Readable,
        size: result.ContentLength ?? 0,
        contentType: result.ContentType ?? CONTENT_TYPES[ext] ?? 'application/octet-stream',
      };
    } catch {
      // Incluye el 404 del bucket: para el que llama, no existe.
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    if (!ASSET_KEY.test(key)) return;
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  publicUrlFor(key: string): string {
    // Con CDN delante, esa es la URL que se guarda en la base y la que carga el
    // celular del comensal.
    const { cdnPublicUrl, endpoint, forcePathStyle, region } = this.config;
    if (cdnPublicUrl) {
      return `${cdnPublicUrl.replace(/\/+$/, '')}/${key}`;
    }
    if (endpoint) {
      const base = endpoint.replace(/\/+$/, '');
      return forcePathStyle ? `${base}/${this.bucket}/${key}` : `${base}/${key}`;
    }
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  describeConfiguration(): StorageConfiguration {
    const { bucket, accessKeyId, secretAccessKey, endpoint, forcePathStyle, cdnPublicUrl } =
      this.config;

    const missing: string[] = [];
    if (!bucket) missing.push('S3_BUCKET');
    if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID');
    if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
    // El CDN no impide cobrar ni subir, pero sin el los modelos salen del
    // bucket sin cache de borde: se reporta aparte.
    if (!cdnPublicUrl) missing.push('CDN_PUBLIC_URL (opcional, pero sin CDN)');

    return {
      ready: Boolean(bucket && accessKeyId && secretAccessKey),
      missing,
      details: {
        driver: 's3',
        bucket: bucket || 'sin definir',
        endpoint: endpoint ?? 'AWS S3',
        pathStyle: forcePathStyle,
        cdn: cdnPublicUrl ?? 'sirviendo desde el bucket',
      },
    };
  }
}
