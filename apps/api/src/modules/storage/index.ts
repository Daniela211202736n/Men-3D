import { env } from '../../env.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { StorageProvider } from './provider.js';

let instance: StorageProvider | null = null;

/** El driver configurado. Se construye una sola vez. */
export function getStorage(): StorageProvider {
  instance ??= env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}

export * from './provider.js';
export { LocalStorage, S3Storage };
