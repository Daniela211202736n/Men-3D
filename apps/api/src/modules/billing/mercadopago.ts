/**
 * Suscripcion mensual con MercadoPago (`preapproval`).
 *
 * Es otra cosa que el cobro de un pedido: ahi el comensal paga una vez y se va;
 * aca el restaurante autoriza a que le cobremos todos los meses. Por eso no
 * reusa el Checkout Pro de `modules/payments`, aunque la verificacion de firma
 * del webhook sea la misma y se importe de alli.
 *
 * El recorrido:
 *
 *   1. El dueño elige un plan en el backoffice.
 *   2. Creamos un `preapproval` en estado `pending` y lo mandamos a `init_point`
 *      a autorizar el debito.
 *   3. MercadoPago avisa por webhook que quedo `authorized`, y recien ahi el
 *      plan pasa a estar activo. No antes: que el dueño vuelva a la pagina no
 *      prueba que haya autorizado nada.
 *   4. Todos los meses cobra y manda un aviso por cada cobro.
 *
 * Lo mismo que en el cobro de pedidos: el estado lo fija el webhook, nunca la
 * vuelta del navegador, que cualquiera puede falsificar escribiendo una URL.
 */
import { MercadoPagoConfig, PreApproval } from 'mercadopago';

import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { centsToAmount, describeError } from '../payments/mercadopago.js';

/** Lo que devuelve el alta: a donde mandar al dueño y con que id seguirlo. */
export interface AltaDeSuscripcion {
  providerRef: string;
  initPoint: string;
}

let cliente: MercadoPagoConfig | null = null;

function getCliente(): MercadoPagoConfig {
  if (!env.MERCADOPAGO_ACCESS_TOKEN) {
    throw new AppError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Falta MERCADOPAGO_ACCESS_TOKEN para cobrar la suscripcion.',
    );
  }
  cliente ??= new MercadoPagoConfig({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
    options: { timeout: 10_000 },
  });
  return cliente;
}

/** Si se puede cobrar la suscripcion con lo que hay configurado. */
export function suscripcionesConfiguradas(): { listo: boolean; faltan: string[] } {
  const faltan: string[] = [];
  if (!env.MERCADOPAGO_ACCESS_TOKEN) faltan.push('MERCADOPAGO_ACCESS_TOKEN');
  if (!env.PUBLIC_API_URL) faltan.push('PUBLIC_API_URL');
  if (!env.MERCADOPAGO_WEBHOOK_SECRET) faltan.push('MERCADOPAGO_WEBHOOK_SECRET');
  return {
    listo: Boolean(env.MERCADOPAGO_ACCESS_TOKEN && env.PUBLIC_API_URL),
    faltan,
  };
}

export async function crearSuscripcion(input: {
  tenantId: string;
  emailDelDueño: string;
  descripcion: string;
  montoMensualCents: number;
  moneda: string;
  urlDeVuelta: string;
}): Promise<AltaDeSuscripcion> {
  const preapproval = new PreApproval(getCliente());

  let respuesta;
  try {
    respuesta = await preapproval.create({
      body: {
        reason: input.descripcion,
        // `external_reference` es el hilo que ata el aviso con el restaurante:
        // los avisos de MercadoPago traen su id, no el nuestro.
        external_reference: input.tenantId,
        payer_email: input.emailDelDueño,
        back_url: input.urlDeVuelta,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: centsToAmount(input.montoMensualCents),
          currency_id: input.moneda,
        },
      },
    });
  } catch (error) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      'MercadoPago no pudo crear la suscripcion.',
      [{ path: 'mercadopago', message: describeError(error) }],
    );
  }

  const providerRef = respuesta?.id;
  const initPoint = respuesta?.init_point;
  if (!providerRef || !initPoint) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      'MercadoPago creo la suscripcion sin devolver id o enlace de pago.',
    );
  }

  return { providerRef, initPoint };
}

/** Da de baja la suscripcion en la pasarela. */
export async function cancelarEnLaPasarela(providerRef: string): Promise<void> {
  const preapproval = new PreApproval(getCliente());
  try {
    await preapproval.update({
      id: providerRef,
      body: { status: 'cancelled' },
    });
  } catch (error) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      'MercadoPago no pudo cancelar la suscripcion.',
      [{ path: 'mercadopago', message: describeError(error) }],
    );
  }
}

/** Consulta el estado real en la pasarela, que es la fuente de verdad. */
export async function consultarSuscripcion(
  providerRef: string,
): Promise<{ status?: string; next_payment_date?: string } | null> {
  const preapproval = new PreApproval(getCliente());
  try {
    return (await preapproval.get({ id: providerRef })) as {
      status?: string;
      next_payment_date?: string;
    };
  } catch {
    return null;
  }
}

/* --------------------------------------------------- traduccion de estados */

/**
 * Estado de MercadoPago → el nuestro.
 *
 * `pending` NO es activo: es "creada, el dueño todavia no autorizo el debito".
 * Tratarla como activa regalaria el plan a quien abre el checkout y lo cierra.
 */
export function mapEstadoSuscripcion(
  estado: string | undefined,
): 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null {
  switch (estado) {
    case 'authorized':
      return 'ACTIVE';
    case 'paused':
      // MercadoPago pausa sola tras varios intentos fallidos.
      return 'PAST_DUE';
    case 'cancelled':
      return 'CANCELED';
    case 'pending':
      return null;
    default:
      return null;
  }
}

/**
 * Estado de un cobro mensual → si entro o no.
 *
 * `recycling` es "lo esta reintentando": todavia no fallo del todo, pero
 * tampoco entro. Se cuenta como fallido para que arranque la gracia, que es
 * justamente el plazo para que el dueño arregle la tarjeta.
 */
export function cobroEntro(estado: string | undefined): boolean {
  return estado === 'processed' || estado === 'approved';
}
