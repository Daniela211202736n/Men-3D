/**
 * Cobro de la configuracion inicial.
 *
 * Es el otro pedazo del modelo comercial: un cobro unico, mas grande que el
 * abono —cubre la carga de la carta y el modelado 3D de los primeros platos—
 * y que hasta ahora se marcaba a mano en la base.
 *
 * No es una suscripcion sino un pago suelto, asi que va por Checkout Pro
 * (`Preference`) y no por `preapproval`. Y no es un pedido, asi que no puede
 * entrar por el webhook de pedidos: ese busca un `Order` por la referencia
 * externa y no lo encontraria. Por eso tiene su propia notificacion.
 *
 * Las dos reglas que se heredan del cobro de pedidos, y que son las que evitan
 * que alguien se regale el servicio:
 *
 *  1. **El estado lo fija el webhook, nunca la vuelta del navegador.** Volver a
 *     la pagina no prueba que se haya pagado; la URL la escribe cualquiera.
 *  2. **El importe se verifica contra la pasarela.** La notificacion solo trae
 *     un id: el cobro se consulta, y si el monto no coincide con el del plan,
 *     no se marca como pagado. Sin eso, bastaria con crear un pago de un peso.
 */
import { Payment, Preference } from 'mercadopago';

import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import {
  amountToCents,
  centsToAmount,
  describeError,
} from '../payments/mercadopago.js';
import { getClienteMercadoPago } from './mercadopago.js';

/** Prefijo de la referencia externa: distingue este cobro de un pedido. */
const PREFIJO = 'setup:';

export function referenciaDeSetup(tenantId: string): string {
  return `${PREFIJO}${tenantId}`;
}

export function tenantDeLaReferencia(referencia: string | undefined): string | null {
  if (!referencia?.startsWith(PREFIJO)) return null;
  return referencia.slice(PREFIJO.length) || null;
}

/** Crea el checkout del cobro inicial y devuelve a donde mandar al dueño. */
export async function crearCobroDeSetup(input: {
  tenantId: string;
  nombreDelLocal: string;
  emailDelDueño: string;
  montoCents: number;
  moneda: string;
  urlDeVuelta: string;
}): Promise<{ checkoutUrl: string; preferenceId: string }> {
  const preference = new Preference(getClienteMercadoPago());

  const notificationUrl = new URL(
    '/api/billing/webhook/mercadopago/setup',
    env.PUBLIC_API_URL ?? 'http://localhost:4000',
  ).toString();

  let respuesta;
  try {
    respuesta = await preference.create({
      body: {
        items: [
          {
            id: input.tenantId,
            title: `Configuracion inicial — ${input.nombreDelLocal}`,
            quantity: 1,
            unit_price: centsToAmount(input.montoCents),
            currency_id: input.moneda,
          },
        ],
        external_reference: referenciaDeSetup(input.tenantId),
        notification_url: notificationUrl,
        back_urls: {
          success: input.urlDeVuelta,
          pending: input.urlDeVuelta,
          failure: input.urlDeVuelta,
        },
        auto_return: 'approved',
        payer: { email: input.emailDelDueño },
        metadata: { tipo: 'setup_fee', tenant_id: input.tenantId },
      },
      requestOptions: {
        // Si el dueño toca "pagar" dos veces, se reutiliza el checkout en vez
        // de abrir dos cobros por lo mismo.
        idempotencyKey: `setup-${input.tenantId}`,
      },
    });
  } catch (error) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      'No pudimos iniciar el cobro de la configuracion inicial.',
      [{ path: 'mercadopago', message: describeError(error) }],
    );
  }

  const checkoutUrl = respuesta?.init_point;
  const preferenceId = respuesta?.id;
  if (!checkoutUrl || !preferenceId) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      'MercadoPago creo el cobro sin devolver enlace de pago.',
    );
  }

  return { checkoutUrl, preferenceId };
}

export interface CobroConsultado {
  tenantId: string;
  aprobado: boolean;
  montoCents: number | null;
  providerRef: string;
  estado: string | undefined;
}

/**
 * Consulta el cobro contra la pasarela.
 *
 * La notificacion solo dice "mira este id". Todo lo que decide —si entro y por
 * cuanto— sale de esta consulta, no del cuerpo del aviso, que es lo unico que
 * un atacante podria falsificar.
 */
export async function consultarCobro(dataId: string): Promise<CobroConsultado | null> {
  const paymentClient = new Payment(getClienteMercadoPago());
  let pago;
  try {
    pago = await paymentClient.get({ id: dataId });
  } catch (error) {
    throw new AppError(
      502,
      'BILLING_PROVIDER_ERROR',
      `No pudimos consultar el cobro ${dataId}: ${describeError(error)}`,
    );
  }

  const tenantId = tenantDeLaReferencia(pago.external_reference ?? undefined);
  // Un cobro sin nuestra referencia no es un setup nuestro: puede ser un pedido
  // o algo de otra aplicacion con la misma cuenta.
  if (!tenantId) return null;

  return {
    tenantId,
    aprobado: pago.status === 'approved',
    montoCents:
      typeof pago.transaction_amount === 'number'
        ? amountToCents(pago.transaction_amount)
        : null,
    providerRef: String(pago.id ?? dataId),
    estado: pago.status,
  };
}

export type ResultadoDelCobro =
  | { aplicado: true; yaEstaba: boolean }
  | { aplicado: false; motivo: 'sin-suscripcion' | 'importe-no-coincide' | 'no-aprobado' };

/**
 * Marca la configuracion como pagada, si el cobro es legitimo.
 *
 * Comprobar el importe no es paranoia: sin eso, cualquiera que supiera armar un
 * pago de un peso con nuestra referencia externa se llevaria el setup gratis.
 */
export async function aplicarCobroDeSetup(
  cobro: CobroConsultado,
): Promise<ResultadoDelCobro> {
  if (!cobro.aprobado) return { aplicado: false, motivo: 'no-aprobado' };

  const suscripcion = await prisma.subscription.findUnique({
    where: { tenantId: cobro.tenantId },
    include: { plan: true },
  });
  if (!suscripcion) return { aplicado: false, motivo: 'sin-suscripcion' };

  const esperado = suscripcion.plan.setupFeeCents;
  if (cobro.montoCents === null || cobro.montoCents < esperado) {
    return { aplicado: false, motivo: 'importe-no-coincide' };
  }

  if (suscripcion.setupFeePaid) return { aplicado: true, yaEstaba: true };

  await prisma.subscription.update({
    where: { id: suscripcion.id },
    data: { setupFeePaid: true },
  });
  return { aplicado: true, yaEstaba: false };
}
