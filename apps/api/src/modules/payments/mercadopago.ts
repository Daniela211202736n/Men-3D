/**
 * Adaptador de MercadoPago (Checkout Pro).
 *
 * Como funciona el cobro, de punta a punta:
 *
 *   1. El comensal confirma el pedido. Creamos una *preferencia* con los items
 *      y guardamos su id; el pedido queda en PENDING_PAYMENT.
 *   2. Lo redirigimos a `init_point`, el checkout alojado por MercadoPago.
 *   3. MercadoPago nos notifica por webhook cada cambio de estado del cobro.
 *      Esa notificacion —no la vuelta del navegador— es la que da el pedido por
 *      pagado: el comensal puede cerrar la pestaña antes de volver, y nadie
 *      puede falsear un pago manipulando una URL de retorno.
 *   4. Verificamos la firma, consultamos el cobro real contra la API y recien
 *      ahi movemos el pedido a PAID.
 *
 * El `external_reference` de la preferencia lleva nuestro id de pedido: es lo
 * que ata la notificacion con nuestra base, porque el id que viaja en el
 * webhook es el del cobro y no el de la preferencia que guardamos.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';

import { env, mercadoPagoIsSandbox } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import type {
  ChargeRequest,
  ChargeResult,
  PaymentProvider,
  ProviderConfiguration,
  WebhookRequest,
  WebhookResult,
} from './provider.js';
import type { PaymentStatus } from '@men3d/shared';

/** Minutos que la preferencia sigue siendo pagable. */
const EXPIRATION_MINUTES = 30;

/**
 * Tolerancia del timestamp de la firma. Acota la ventana en la que sirve
 * reenviar una notificacion interceptada, sin romper por un reloj algo corrido
 * ni por un reintento tardio de MercadoPago.
 */
const SIGNATURE_TOLERANCE_SECONDS = 15 * 60;

/* ------------------------------------------------------------ conversiones */

/**
 * MercadoPago trabaja en unidades mayores (pesos con decimales); nosotros, en
 * centavos enteros. Estas dos funciones son el unico lugar que cruza esa
 * frontera, y van juntas para que nadie toque una sin mirar la otra.
 */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export function amountToCents(amount: number): number {
  // El redondeo evita que 123.45 * 100 = 12344.999... termine en 12344.
  return Math.round(amount * 100);
}

/**
 * Estados de MercadoPago traducidos a los nuestros.
 *
 * `pending` e `in_process` quedan como PROCESSING a proposito: un pago en
 * efectivo por Rapipago puede tardar horas en acreditarse, y la cocina no tiene
 * que empezar a cocinar hasta que el dinero este.
 */
export function mapPaymentStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'approved':
      return 'SUCCEEDED';
    case 'authorized':
    case 'pending':
    case 'in_process':
    case 'in_mediation':
      return 'PROCESSING';
    case 'refunded':
    case 'charged_back':
      return 'REFUNDED';
    case 'rejected':
    case 'cancelled':
      return 'FAILED';
    default:
      // Un estado que no conocemos nunca se interpreta como cobrado.
      return 'PROCESSING';
  }
}

/* -------------------------------------------------------- firma del webhook */

export interface ParsedSignature {
  ts: string;
  v1: string;
}

/** Descompone la cabecera `x-signature`: `ts=1704908010,v1=618c85…`. */
export function parseSignatureHeader(header: string | undefined): ParsedSignature | null {
  if (!header) return null;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    const value = rest.join('=').trim();
    if (!key || !value) continue;
    if (key === 'ts') ts ??= value;
    // Se toma la primera version presente, como hace el SDK oficial.
    else if (key === 'v1') v1 ??= value;
  }
  return ts && v1 ? { ts, v1 } : null;
}

/**
 * Arma el manifiesto que MercadoPago firma.
 *
 * Reglas que importan y que son facil de pasar por alto: `data.id` va en
 * minusculas, y cada par se omite entero cuando su valor falta (no se deja el
 * prefijo suelto). Un manifiesto mal armado hace fallar firmas legitimas.
 */
export function buildSignatureManifest(input: {
  dataId: string | undefined;
  requestId: string | undefined;
  ts: string;
}): string {
  let manifest = '';
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${input.ts};`;
  return manifest;
}

export interface SignatureCheck {
  valid: boolean;
  reason?: string;
}

/** Verifica la firma en tiempo constante y controla la deriva del reloj. */
export function verifySignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { valid: false, reason: 'cabecera x-signature ausente o ilegible' };

  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const ts = Number(parsed.ts);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'timestamp de la firma invalido' };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // El timestamp de MercadoPago viene en segundos; si llegara en milisegundos
  // la diferencia seria enorme y caeria igual en esta comprobacion.
  if (Math.abs(now - ts) > tolerance) {
    return { valid: false, reason: 'la firma esta fuera de la ventana de tolerancia' };
  }

  const manifest = buildSignatureManifest({
    dataId: input.dataId,
    requestId: input.requestId,
    ts: parsed.ts,
  });
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');

  const received = parsed.v1.toLowerCase();
  // `timingSafeEqual` exige longitudes iguales: compararlas antes evita que
  // lance, y la longitud del hash no es un secreto.
  if (received.length !== expected.length) {
    return { valid: false, reason: 'la firma no coincide' };
  }
  const ok = timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
  return ok ? { valid: true } : { valid: false, reason: 'la firma no coincide' };
}

/* ------------------------------------------------------------- utilidades */

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Lee `data.id` del body o de la query, que es por donde llega segun el caso. */
export function extractDataId(request: WebhookRequest): string | undefined {
  const body = request.body as { data?: { id?: unknown }; id?: unknown } | null;
  const fromBody = body?.data?.id ?? body?.id;
  if (typeof fromBody === 'string' && fromBody) return fromBody;
  if (typeof fromBody === 'number') return String(fromBody);

  return (
    firstValue(request.query['data.id']) ??
    firstValue(request.query['id']) ??
    undefined
  );
}

/** Tipo de notificacion: solo nos interesan las de cobros. */
export function extractNotificationType(request: WebhookRequest): string | undefined {
  const body = request.body as { type?: unknown; topic?: unknown } | null;
  if (typeof body?.type === 'string') return body.type;
  if (typeof body?.topic === 'string') return body.topic;
  return firstValue(request.query['type']) ?? firstValue(request.query['topic']);
}

/* -------------------------------------------------------------- adaptador */

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago';

  /** Cliente perezoso: no se construye si el tenant cobra con otra pasarela. */
  private client: MercadoPagoConfig | null = null;

  describeConfiguration(): ProviderConfiguration {
    const missing: string[] = [];
    if (!env.MERCADOPAGO_ACCESS_TOKEN) missing.push('MERCADOPAGO_ACCESS_TOKEN');
    if (!env.PUBLIC_API_URL) missing.push('PUBLIC_API_URL');
    // La firma no impide cobrar, pero sin ella no se puede confiar en los
    // avisos de pago: se reporta aparte para que se note.
    if (!env.MERCADOPAGO_WEBHOOK_SECRET) missing.push('MERCADOPAGO_WEBHOOK_SECRET');

    return {
      ready: Boolean(env.MERCADOPAGO_ACCESS_TOKEN && env.PUBLIC_API_URL),
      missing,
      details: {
        sandbox: mercadoPagoIsSandbox,
        signatureVerification: Boolean(env.MERCADOPAGO_WEBHOOK_SECRET),
        notificationUrl: env.PUBLIC_API_URL
          ? new URL('/api/payments/webhook/mercadopago', env.PUBLIC_API_URL).toString()
          : 'sin PUBLIC_API_URL',
      },
    };
  }

  private getClient(): MercadoPagoConfig {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'Falta MERCADOPAGO_ACCESS_TOKEN para poder cobrar con MercadoPago.',
      );
    }
    this.client ??= new MercadoPagoConfig({
      accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
      options: { timeout: 10_000 },
    });
    return this.client;
  }

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const preference = new Preference(this.getClient());

    const notificationUrl = new URL(
      '/api/payments/webhook/mercadopago',
      env.PUBLIC_API_URL ?? 'http://localhost:4000',
    ).toString();

    const expiresAt = new Date(Date.now() + EXPIRATION_MINUTES * 60_000);

    let response;
    try {
      response = await preference.create({
        body: {
          items: [
            {
              // Un solo item con el total ya calculado: el desglose por plato
              // vive en nuestra base, y mandarlo duplicado abre la puerta a que
              // la suma de MercadoPago difiera de la nuestra por redondeo.
              id: request.orderId,
              title: request.description,
              quantity: 1,
              unit_price: centsToAmount(request.amountCents),
              currency_id: request.currency,
            },
          ],
          external_reference: request.orderId,
          notification_url: notificationUrl,
          back_urls: {
            success: request.returnUrl,
            pending: request.returnUrl,
            failure: request.returnUrl,
          },
          // Vuelve solo al comercio cuando el pago se aprueba.
          auto_return: 'approved',
          statement_descriptor: request.description.slice(0, 22),
          expires: true,
          expiration_date_to: expiresAt.toISOString(),
          ...(request.customerEmail ? { payer: { email: request.customerEmail } } : {}),
          metadata: { order_id: request.orderId, order_code: request.orderCode },
        },
        requestOptions: {
          // Si el comensal toca "pagar" dos veces, se reutiliza la preferencia
          // en vez de abrir dos checkouts para el mismo pedido.
          idempotencyKey: `order-${request.orderId}`,
        },
      });
    } catch (error) {
      throw new AppError(
        502,
        'PAYMENT_GATEWAY_ERROR',
        'No pudimos iniciar el pago con MercadoPago. Intenta de nuevo en un momento.',
        [{ path: 'mercadopago', message: describeError(error) }],
      );
    }

    // En sandbox el checkout que funciona es `sandbox_init_point`.
    const checkoutUrl = mercadoPagoIsSandbox
      ? (response.sandbox_init_point ?? response.init_point ?? null)
      : (response.init_point ?? null);

    if (!checkoutUrl) {
      throw new AppError(
        502,
        'PAYMENT_GATEWAY_ERROR',
        'MercadoPago no devolvio una URL de checkout.',
      );
    }

    return {
      provider: this.name,
      // El cobro recien empieza: el pedido no esta pagado hasta que llegue el
      // webhook con el pago aprobado.
      status: 'PROCESSING',
      providerRef: response.id ?? null,
      checkoutUrl,
      clientSecret: null,
      raw: {
        preference_id: response.id,
        sandbox: mercadoPagoIsSandbox,
        expires_at: expiresAt.toISOString(),
      },
    };
  }

  async parseWebhook(request: WebhookRequest): Promise<WebhookResult | null> {
    const type = extractNotificationType(request);
    // MercadoPago notifica muchos recursos (merchant_order, plan, suscripciones).
    // Solo los cobros mueven el estado de un pedido.
    if (type && type !== 'payment') return null;

    const dataId = extractDataId(request);
    if (!dataId) return null;

    const secret = env.MERCADOPAGO_WEBHOOK_SECRET;
    if (secret) {
      const check = verifySignature({
        signatureHeader: firstValue(request.headers['x-signature']),
        requestId: firstValue(request.headers['x-request-id']),
        dataId,
        secret,
      });
      if (!check.valid) {
        throw new AppError(
          401,
          'WEBHOOK_SIGNATURE_INVALID',
          `Notificacion de MercadoPago rechazada: ${check.reason}`,
        );
      }
    } else {
      // Solo puede pasar fuera de produccion: env.ts lo exige al arrancar.
      console.warn(
        '[mercadopago] MERCADOPAGO_WEBHOOK_SECRET sin definir: la notificacion ' +
          'se procesa SIN verificar la firma. No usar asi en produccion.',
      );
    }

    // La notificacion solo trae un id. El estado real se consulta contra la API:
    // asi un atacante que lograra falsear una notificacion tampoco podria
    // inventar que el pago fue aprobado.
    const paymentClient = new Payment(this.getClient());
    let payment;
    try {
      payment = await paymentClient.get({ id: dataId });
    } catch (error) {
      throw new AppError(
        502,
        'PAYMENT_GATEWAY_ERROR',
        `No pudimos consultar el cobro ${dataId} en MercadoPago: ${describeError(error)}`,
      );
    }

    const orderId = payment.external_reference;
    if (!orderId) {
      // Un cobro sin referencia no corresponde a ningun pedido nuestro.
      return null;
    }

    return {
      orderId,
      providerRef: String(payment.id ?? dataId),
      status: mapPaymentStatus(payment.status),
      amountCents:
        typeof payment.transaction_amount === 'number'
          ? amountToCents(payment.transaction_amount)
          : null,
      raw: {
        id: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        transaction_amount: payment.transaction_amount,
        date_approved: payment.date_approved,
        live_mode: payment.live_mode,
      },
    };
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
