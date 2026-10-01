/**
 * Recepcion de webhooks de las pasarelas.
 *
 * Es una ruta publica: no la protege un token sino la firma de la notificacion,
 * que verifica cada adaptador. Por eso vive fuera del grupo /api/admin.
 *
 * Politica de codigos de respuesta, que no es cosmetica — MercadoPago reintenta
 * todo lo que no sea 2xx, con espera creciente, durante horas:
 *
 *   200  procesado, o reconocido y descartado por no interesarnos. No reintentar.
 *   401  la firma no verifica. No es nuestro problema de disponibilidad: la
 *        notificacion no es legitima y no queremos que insista.
 *   502  no pudimos consultar el cobro contra la pasarela. Si queremos que
 *        reintente: el pago puede ser real y el fallo, nuestro o de la red.
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

import { notFound } from '../../lib/errors.js';
import { applyPaymentUpdate } from '../orders/service.js';
import { getProviderByName } from './provider.js';

export default async function paymentWebhookRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Limite propio y generoso: una notificacion perdida es un pedido que la
  // cocina nunca ve, pero tampoco se deja la puerta abierta de par en par.
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
  });

  app.post('/webhook/:provider', async (request, reply) => {
    const { provider: providerName } = request.params as { provider: string };

    const provider = getProviderByName(providerName);
    if (!provider) throw notFound('Pasarela de pagos');

    const result = await provider.parseWebhook({
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[] | undefined>,
    });

    // Notificacion legitima de algo que no nos mueve el pedido.
    if (!result) return reply.status(200).send({ received: true, applied: false });

    const outcome = await applyPaymentUpdate({
      orderId: result.orderId,
      providerRef: result.providerRef,
      provider: provider.name,
      status: result.status,
      amountCents: result.amountCents,
      raw: result.raw,
    });

    // Un desajuste de importe se registra y se avisa fuerte: es la señal de que
    // alguien intento pagar menos de lo que vale el pedido.
    if (outcome.outcome === 'recorded' && outcome.reason?.startsWith('el importe')) {
      request.log.error(
        { orderId: result.orderId, providerRef: result.providerRef },
        `webhook de ${provider.name}: ${outcome.reason}`,
      );
    } else {
      request.log.info(
        { orderId: result.orderId, outcome: outcome.outcome },
        `webhook de ${provider.name} procesado`,
      );
    }

    // Siempre 200 cuando la notificacion se proceso: que el pedido ya estuviera
    // pagado o que el cobro siga pendiente no es un fallo que deba reintentarse.
    return reply.status(200).send({
      received: true,
      applied: outcome.outcome === 'settled',
      outcome: outcome.outcome,
    });
  });

  /**
   * Sonda de configuracion: permite ver si la pasarela puede cobrar antes de
   * que un comensal lo descubra por las malas. Nombra lo que falta, nunca lo
   * que hay: ninguna credencial sale por aca.
   */
  app.get('/webhook/:provider/health', async (request) => {
    const { provider: providerName } = request.params as { provider: string };
    const provider = getProviderByName(providerName);
    if (!provider) throw notFound('Pasarela de pagos');
    return { provider: provider.name, ...provider.describeConfiguration() };
  });
}
