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
  // --- correo --------------------------------------------------------------
  /**
   * `log` imprime el correo en la consola (desarrollo: el enlace de
   * recuperacion sale en el log). `resend` envia de verdad.
   */
  /**
   * Intentos de autenticacion por IP cada 5 minutos.
   *
   * El valor por defecto frena la fuerza bruta sin molestar a nadie, pero un
   * local donde todo el equipo entra desde el mismo wifi sale por una sola IP:
   * si son muchos, conviene subirlo. Tambien lo suben las pruebas, que recorren
   * el flujo entero de autenticacion muchas veces seguidas.
   */
  /**
   * Redis para el bus de eventos del KDS.
   *
   * Sin esto el bus vive en memoria, que alcanza con una sola instancia de la
   * API. Con varias es obligatorio: sin el, una pantalla de cocina conectada a
   * otra instancia nunca se entera de los pedidos nuevos, y el fallo es mudo.
   */
  REDIS_URL: z.string().url().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  /**
   * Peticiones al boton de arrepentimiento por IP cada diez minutos.
   *
   * Cinco le sobran a una persona que se arrepiente. Es configurable por la
   * misma razon que el de autenticacion: el recorrido de navegador manda
   * formularios de verdad y el contador vive en el servidor, asi que correrlo
   * dos veces seguidas con el limite de produccion da un falso rojo.
   */
  REVOCATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  /** Remitente verificado, p. ej. "Men-3D <hola@tu-dominio.com>". */
  MAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  /**
   * Casilla que recibe los pedidos del boton de arrepentimiento.
   *
   * La Res. 424/2020 obliga a informarle al consumidor el codigo de revocacion
   * dentro de las 24 horas, y eso lo hace el sistema solo. Pero HONRAR la
   * revocacion —dar de baja y reintegrar— es trabajo de una persona, y sin esta
   * casilla nadie se entera de que hay un pedido esperando. Sin definirla, el
   * pedido queda igual guardado en la base y el aviso se escribe en el log.
   */
  LEGAL_EMAIL: z.string().email().optional(),

  // --- almacenamiento de modelos 3D e imagenes -----------------------------
  /**
   * `local` guarda en disco y sirve desde la API: alcanza para desarrollo.
   * `s3` sube a un bucket (S3, Cloudflare R2, DigitalOcean Spaces) y deja que
   * el CDN sirva los modelos directo al navegador, que es lo que hay que hacer
   * en produccion: un GLB servido desde Node es la forma mas rapida de arruinar
   * el tiempo de carga en un celular.
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Carpeta donde se guardan los GLB/imagenes con el driver `local`. */
  STORAGE_DIR: z.string().default(resolve(here, '../storage')),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  /** Endpoint propio de R2/Spaces/MinIO. Vacio = AWS S3. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /**
   * `true` para servidores que no resuelven el bucket por subdominio
   * (MinIO y la mayoria de los compatibles).
   */
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  /**
   * Dominio publico desde el que se sirven los assets (el del CDN). Sin esto se
   * arma la URL del bucket, que funciona pero no pasa por cache de borde.
   */
  CDN_PUBLIC_URL: z.string().url().optional(),
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

/**
 * Elegir el bucket sin credenciales se descubre al arrancar, no cuando un
 * restaurante intenta subir el modelo 3D de un plato.
 */
if (env.STORAGE_DRIVER === 's3') {
  const faltantes: string[] = [];
  if (!env.S3_BUCKET) faltantes.push('S3_BUCKET');
  if (!env.S3_ACCESS_KEY_ID) faltantes.push('S3_ACCESS_KEY_ID');
  if (!env.S3_SECRET_ACCESS_KEY) faltantes.push('S3_SECRET_ACCESS_KEY');
  if (faltantes.length > 0) {
    throw new Error(
      `STORAGE_DRIVER=s3 requiere: ${faltantes.join(', ')}. Ver docs/DEPLOY.md.`,
    );
  }
}

if (env.MAIL_DRIVER === 'resend') {
  const faltantes: string[] = [];
  if (!env.RESEND_API_KEY) faltantes.push('RESEND_API_KEY');
  if (!env.MAIL_FROM) faltantes.push('MAIL_FROM');
  if (faltantes.length > 0) {
    throw new Error(
      `MAIL_DRIVER=resend requiere: ${faltantes.join(', ')}. Ver docs/DEPLOY.md.`,
    );
  }
}

if (isProduction && env.MAIL_DRIVER === 'log') {
  // Nadie recupera su contraseña si el correo solo se imprime en un log.
  console.warn(
    '[mail] MAIL_DRIVER=log en produccion: NINGUN correo se envia de verdad, ' +
      'incluido el de recuperacion de contraseña. Ver docs/DEPLOY.md.',
  );
}

if (isProduction && env.STORAGE_DRIVER === 'local') {
  // No es un error fatal —se puede querer para una prueba— pero si se despliega
  // asi, la carta va a cargar lenta y los modelos se pierden al recrear el
  // contenedor.
  console.warn(
    '[storage] STORAGE_DRIVER=local en produccion: los modelos 3D se sirven ' +
      'desde la API y viven en el disco del contenedor. Usar s3 (ver docs/DEPLOY.md).',
  );
}

/** `true` cuando el access token es de sandbox. */
export const mercadoPagoIsSandbox =
  env.MERCADOPAGO_ACCESS_TOKEN?.startsWith('TEST-') ?? false;

/** La IA es opcional: sin clave el sistema degrada a reglas deterministas. */
export const aiEnabled = Boolean(env.ANTHROPIC_API_KEY);
