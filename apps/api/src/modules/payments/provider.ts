/**
 * Pasarela de pagos detras de una interfaz, para que el resto del sistema no
 * sepa con quien cobra.
 *
 * El MVP trae implementado `mock` (cobro simulado, util para demos y tests) y
 * los adaptadores de Stripe y MercadoPago declarados pero sin implementar: el
 * contrato esta fijado y cada uno es un archivo nuevo, no una refactorizacion.
 */
import type { PaymentStatus } from '@men3d/shared';

import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';

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

export interface PaymentProvider {
  readonly name: string;
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  /**
   * Valida y normaliza un webhook de la pasarela.
   * Devuelve `null` si el evento no interesa.
   */
  parseWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ providerRef: string; status: PaymentStatus } | null>;
}

/**
 * Cobro simulado: aprueba al instante. Permite recorrer todo el flujo (carrito
 * -> pago -> KDS) sin credenciales de ninguna pasarela.
 */
class MockProvider implements PaymentProvider {
  readonly name = 'mock';

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

/** Hueco para MercadoPago (Checkout Pro): crea preferencia y devuelve init_point. */
class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago';

  async createCharge(): Promise<ChargeResult> {
    throw new AppError(
      501,
      'PAYMENT_PROVIDER_NOT_IMPLEMENTED',
      'El adaptador de MercadoPago todavia no esta implementado. Configura ' +
        'PAYMENTS_PROVIDER=mock o implementa apps/api/src/modules/payments/mercadopago.ts',
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
