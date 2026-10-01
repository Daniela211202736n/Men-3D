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
  /** Access token de la aplicacion (TEST-... en sandbox, APP_USR-... en vivo). */
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  /**
   * Clave con la que MercadoPago firma los webhooks. Se copia del panel, en
   * "Tus integraciones -> Webhooks". Sin ella no se puede verificar que una
   * notificacion venga realmente de MercadoPago.
   */
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  /**
   * URL publica de esta API. MercadoPago la usa para notificar los cambios de
   * estado del pago, asi que tiene que ser alcanzable desde internet (en
   * desarrollo, un tunel tipo ngrok).
   */
  PUBLIC_API_URL: z.string().url().optional(),
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

/**
 * Elegir una pasarela real sin sus credenciales es un error de configuracion que
 * conviene descubrir al arrancar, no cuando un comensal intenta pagar.
 */
if (env.PAYMENTS_PROVIDER === 'mercadopago') {
  const faltantes: string[] = [];
  if (!env.MERCADOPAGO_ACCESS_TOKEN) faltantes.push('MERCADOPAGO_ACCESS_TOKEN');
  if (!env.PUBLIC_API_URL) faltantes.push('PUBLIC_API_URL');
  if (faltantes.length > 0) {
    throw new Error(
      `PAYMENTS_PROVIDER=mercadopago requiere: ${faltantes.join(', ')}. ` +
        'Ver docs/PAYMENTS.md.',
    );
  }
  if (isProduction && !env.MERCADOPAGO_WEBHOOK_SECRET) {
    // Sin secreto no se puede verificar la firma: cualquiera podria avisar que
    // un pedido fue pagado. En desarrollo se permite para poder probar sin panel.
    throw new Error(
      'En produccion, MERCADOPAGO_WEBHOOK_SECRET es obligatorio: sin el no se ' +
        'puede verificar que una notificacion de pago sea legitima.',
    );
  }
}

/** `true` cuando el access token es de sandbox. */
export const mercadoPagoIsSandbox =
  env.MERCADOPAGO_ACCESS_TOKEN?.startsWith('TEST-') ?? false;

/** La IA es opcional: sin clave el sistema degrada a reglas deterministas. */
export const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);
