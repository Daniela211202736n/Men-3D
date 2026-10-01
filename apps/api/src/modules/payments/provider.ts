/**
 * Pasarela de pagos detras de una interfaz, para que el resto del sistema no
 * sepa con quien cobra.
 *
 * Implementados: `mock` (cobro simulado, para demos y tests) y `mercadopago`
 * (Checkout Pro con redireccion y webhook firmado). El adaptador de Stripe
 * sigue declarado con su contrato pero sin implementar.
 */
import type { PaymentStatus } from '@men3d/shared';

import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { MercadoPagoProvider } from './mercadopago.js';

export interface ChargeRequest {
  orderId: string;
  orderCode: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string | null;
  /** A donde volver tras pagar en una pasarela con redireccion. */
  returnUrl: string;
}

export interface ChargeResult {
  provider: string;
  status: PaymentStatus;
  /** Referencia del cobro en la pasarela. */
  providerRef: string | null;
  /** Para pasarelas con redireccion (MercadoPago Checkout Pro). */
  checkoutUrl?: string | null;
  /** Para pasarelas embebidas (Stripe Payment Element). */
  clientSecret?: string | null;
  raw?: unknown;
}

/** Lo que la API necesita saber de una notificacion de la pasarela. */
export interface WebhookResult {
  /**
   * Pedido al que corresponde. Es el dato que ata la notificacion con nuestra
   * base: el id que viaja en el webhook es el del *cobro* en la pasarela, que
   * no es el mismo que guardamos al crear la intencion de pago.
   */
  orderId: string;
  /** Id del cobro en la pasarela, para guardarlo y poder conciliar. */
  providerRef: string;
  status: PaymentStatus;
  /**
   * Importe realmente cobrado, en centavos. Se compara contra el total del
   * pedido: si no coinciden, algo se manipulo y no se da por pagado.
   */
  amountCents: number | null;
  /** Respuesta cruda, para auditoria. */
  raw: unknown;
}

/** Lo que llega de una peticion de webhook, sin acoplarse a Fastify. */
export interface WebhookRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** MercadoPago manda `data.id` y `type` tambien por query string. */
  query: Record<string, string | string[] | undefined>;
}

/** Estado de configuracion de una pasarela, sin exponer ninguna credencial. */
export interface ProviderConfiguration {
  /** `true` si la pasarela puede cobrar ahora mismo. */
  ready: boolean;
  /** Que falta para que lo este. */
  missing: string[];
  /** Detalles utiles que no son secretos (modo sandbox, firma activa...). */
  details: Record<string, boolean | string>;
}

export interface PaymentProvider {
  readonly name: string;
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  /** Para la sonda de configuracion: dice que falta, no que haya. */
  describeConfiguration(): ProviderConfiguration;
  /**
   * Valida y normaliza un webhook de la pasarela.
   *
   * Devuelve `null` cuando el evento es legitimo pero no interesa (por ejemplo
   * una notificacion de otro recurso). Lanza cuando la notificacion no se puede
   * verificar: ahi no hay que responder 200.
   */
  parseWebhook(request: WebhookRequest): Promise<WebhookResult | null>;
}

/**
 * Cobro simulado: aprueba al instante. Permite recorrer todo el flujo (carrito
 * -> pago -> KDS) sin credenciales de ninguna pasarela.
 */
class MockProvider implements PaymentProvider {
  readonly name = 'mock';

  describeConfiguration(): ProviderConfiguration {
    // El proveedor simulado no necesita nada para funcionar.
    return { ready: true, missing: [], details: { simulated: true } };
  }

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    return {
      provider: this.name,
      status: 'SUCCEEDED',
      providerRef: `mock_${request.orderCode}_${Date.now()}`,
      checkoutUrl: null,
      clientSecret: null,
      raw: { simulated: true, amountCents: request.amountCents },
    };
  }

  async parseWebhook(): Promise<null> {
    // El proveedor simulado no emite webhooks: el cobro ya resolvio.
    return null;
  }
}

/**
 * Hueco para Stripe. Implementacion esperada: crear un PaymentIntent con
 * `amount`, `currency` y `metadata.orderId`, devolver `client_secret`, y
 * verificar la firma `stripe-signature` en el webhook.
 */
class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';

  describeConfiguration(): ProviderConfiguration {
    return {
      ready: false,
      missing: ['adaptador sin implementar'],
      details: { implemented: false },
    };
  }

  async createCharge(): Promise<ChargeResult> {
    throw new AppError(
      501,
      'PAYMENT_PROVIDER_NOT_IMPLEMENTED',
      'El adaptador de Stripe todavia no esta implementado. Configura ' +
        'PAYMENTS_PROVIDER=mock o implementa apps/api/src/modules/payments/stripe.ts',
    );
  }

  async parseWebhook(): Promise<null> {
    return null;
  }
}

const providers: Record<string, PaymentProvider> = {
  mock: new MockProvider(),
  stripe: new StripeProvider(),
  mercadopago: new MercadoPagoProvider(),
};

export function getPaymentProvider(): PaymentProvider {
  return providers[env.PAYMENTS_PROVIDER] ?? providers.mock!;
}

/** Busca un proveedor por nombre (lo usa la ruta de webhooks). */
export function getProviderByName(name: string): PaymentProvider | null {
  return providers[name] ?? null;
}
