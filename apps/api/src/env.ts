/**
 * Carga y valida la configuracion. Si falta algo critico el proceso muere al
 * arrancar con un mensaje claro, en vez de fallar a mitad de un request.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const here = resolve(fileURLToPath(import.meta.url), '..');
// .env del paquete y, como respaldo, el de la raiz del monorepo.
dotenv.config({ path: resolve(here, '../.env') });
dotenv.config({ path: resolve(here, '../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres')
    .default('men3d-dev-secret-cambiar-en-produccion-xxxx'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  PAYMENTS_PROVIDER: z.enum(['mock', 'stripe', 'mercadopago']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Carpeta donde se guardan los GLB/imagenes subidos en desarrollo. */
  STORAGE_DIR: z.string().default(resolve(here, '../storage')),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Configuracion invalida:\n${detail}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';

/** Origenes permitidos por CORS. */
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (isProduction && env.JWT_SECRET.startsWith('men3d-dev-secret')) {
  throw new Error(
    'JWT_SECRET sigue en su valor de desarrollo; definilo antes de desplegar.',
  );
}

/** La IA es opcional: sin clave el sistema degrada a reglas deterministas. */
export const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);
