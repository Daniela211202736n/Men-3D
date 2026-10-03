/**
 * Suscripcion al SaaS: alta, estado, baja y el aviso de la pasarela.
 *
 * Las tres primeras viven bajo /api/admin (solo el dueño las toca). El webhook
 * es publico —lo llama MercadoPago— y lo protege la firma, igual que el de los
 * pedidos.
 */
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

import { env } from '../../env.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import {
  extractDataId,
  extractNotificationType,
  verifySignature,
} from '../payments/mercadopago.js';
import {
  aplicarCobroDeSetup,
  consultarCobro,
  crearCobroDeSetup,
} from './setup-fee.js';
import {
  cancelarEnLaPasarela,
  cobroEntro,
  consultarSuscripcion,
  crearSuscripcion,
  mapEstadoSuscripcion,
  suscripcionesConfiguradas,
} from './mercadopago.js';
import {
  cancelar,
  graciaVencida,
  registrarAviso,
  registrarCobro,
  registrarCobroFallido,
  suspenderSiVencio,
  DIAS_DE_GRACIA,
} from './service.js';
import { invalidateTenantFeatures } from '../plans/features.js';

/** Un mes por delante, que es lo que cobra MercadoPago cada vez. */
function finDelProximoPeriodo(desde = new Date()): Date {
  const fin = new Date(desde);
  fin.setMonth(fin.getMonth() + 1);
  return fin;
}

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  /** Estado de la suscripcion, para la pantalla de plan. */
  app.get('/subscription', async (request) => {
    const { tenantId } = request.authUser!;
    // Solo este restaurante: si el dueño entra el dia 8 ve la verdad aunque la
    // tarea programada no haya corrido, y leer su plan no escribe en los demas.
    await suspenderSiVencio(tenantId);

    const sub = await prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub) return { status: 'CANCELED', provider: 'MANUAL' };

    return {
      status: sub.status,
      provider: sub.provider,
      tier: sub.plan.tier,
      monthlyCents: sub.plan.monthlyCents,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
      lastPaymentAt: sub.lastPaymentAt?.toISOString() ?? null,
      diasDeGracia: DIAS_DE_GRACIA,
      pasarelaLista: suscripcionesConfiguradas().listo,
    };
  });

  /**
   * Arranca el debito mensual: devuelve el enlace a donde autorizarlo.
   *
   * No activa nada. El plan se activa cuando MercadoPago avisa que el dueño
   * autorizo el debito: que vuelva a la pagina no prueba que lo haya hecho.
   */
  app.post(
    '/subscription',
    { preHandler: [app.requireRole('OWNER')] },
    async (request) => {
      const { tenantId, email } = request.authUser!;

      const sub = await prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true, tenant: { select: { name: true, currency: true } } },
      });
      if (!sub) throw notFound('Suscripcion');
      if (sub.plan.monthlyCents <= 0) {
        throw badRequest(
          'El plan gratuito no se cobra. Elegi un plan pago primero.',
          'PLAN_SIN_ABONO',
        );
      }
      if (sub.status === 'ACTIVE' && sub.provider === 'MERCADOPAGO') {
        throw conflict('Ya tenes el debito mensual activo.');
      }

      const { providerRef, initPoint } = await crearSuscripcion({
        tenantId,
        emailDelDueño: email,
        descripcion: `Men-3D ${sub.plan.name} — ${sub.tenant.name}`,
        montoMensualCents: sub.plan.monthlyCents,
        moneda: sub.tenant.currency,
        urlDeVuelta: new URL('/admin/plan', env.PUBLIC_WEB_URL).toString(),
      });

      await prisma.subscription.update({
        where: { id: sub.id },
        data: { provider: 'MERCADOPAGO', providerRef },
      });

      return { initPoint, providerRef };
    },
  );

  /**
   * Arranca el cobro de la configuracion inicial.
   *
   * Igual que el abono: devuelve a donde pagar, y lo que marca el cobro como
   * hecho es el aviso de la pasarela, nunca la vuelta del navegador.
   */
  app.post(
    '/subscription/setup-fee',
    { preHandler: [app.requireRole('OWNER')] },
    async (request) => {
      const { tenantId, email } = request.authUser!;

      const sub = await prisma.subscription.findUnique({
        where: { tenantId },
        include: { plan: true, tenant: { select: { name: true, currency: true } } },
      });
      if (!sub) throw notFound('Suscripcion');
      if (sub.setupFeePaid) {
        throw conflict('La configuracion inicial ya esta paga.');
      }
      if (sub.plan.setupFeeCents <= 0) {
        throw badRequest(
          'Tu plan no tiene cobro de configuracion inicial.',
          'SIN_SETUP_FEE',
        );
      }

      const { checkoutUrl } = await crearCobroDeSetup({
        tenantId,
        nombreDelLocal: sub.tenant.name,
        emailDelDueño: email,
        montoCents: sub.plan.setupFeeCents,
        moneda: sub.tenant.currency,
        urlDeVuelta: new URL('/admin/plan', env.PUBLIC_WEB_URL).toString(),
      });

      return { checkoutUrl, montoCents: sub.plan.setupFeeCents };
    },
  );

  /** Baja del debito mensual. Lo cargado no se toca. */
  app.delete(
    '/subscription',
    { preHandler: [app.requireRole('OWNER')] },
    async (request) => {
      const { tenantId } = request.authUser!;
      const sub = await prisma.subscription.findUnique({ where: { tenantId } });
      if (!sub) throw notFound('Suscripcion');

      if (sub.providerRef && sub.provider === 'MERCADOPAGO') {
        await cancelarEnLaPasarela(sub.providerRef);
      }
      await cancelar(sub.id);
      return {
        status: 'CANCELED',
        mensaje:
          'Diste de baja el abono. La carta y el visor 3D siguen funcionando con el plan gratuito.',
      };
    },
  );
}

/**
 * Avisos de MercadoPago sobre suscripciones. Ruta publica, protegida por firma.
 *
 * Codigos, con el mismo criterio que el webhook de pedidos —MercadoPago
 * reintenta todo lo que no sea 2xx:
 *
 *   200  procesado, o reconocido y descartado. No reintentar.
 *   401  la firma no verifica: la notificacion no es legitima.
 *   502  no pudimos consultar la pasarela. Que reintente.
 */
export async function billingWebhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.post('/webhook/mercadopago/subscription', async (request, reply) => {
    const tipo = extractNotificationType({
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[] | undefined>,
    });
    const dataId = extractDataId({
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[] | undefined>,
    });

    // Sin secreto no se puede confiar en el aviso. Se rechaza en vez de
    // aplicarlo a ciegas: un aviso de "cobro entro" sin verificar es un plan
    // regalado a quien sepa la URL.
    if (!env.MERCADOPAGO_WEBHOOK_SECRET) {
      request.log.error('llego un aviso de suscripcion sin MERCADOPAGO_WEBHOOK_SECRET');
      return reply.status(401).send({ error: 'sin verificacion de firma configurada' });
    }

    const firma = verifySignature({
      signatureHeader: request.headers['x-signature'] as string | undefined,
      requestId: request.headers['x-request-id'] as string | undefined,
      dataId,
      secret: env.MERCADOPAGO_WEBHOOK_SECRET,
    });
    if (!firma.valid) {
      request.log.warn({ motivo: firma.reason }, 'aviso de suscripcion con firma invalida');
      return reply.status(401).send({ error: firma.reason });
    }

    if (!dataId) return reply.status(200).send({ received: true, applied: false });

    // Nos interesan dos tipos: el estado de la autorizacion y cada cobro.
    const esAutorizacion = tipo === 'subscription_preapproval';
    const esCobro = tipo === 'subscription_authorized_payment';
    if (!esAutorizacion && !esCobro) {
      return reply.status(200).send({ received: true, applied: false });
    }

    // Idempotencia antes de tocar nada: MercadoPago reintenta, y aplicar dos
    // veces el aviso de un cobro correria el periodo dos veces.
    const cuerpo = request.body as Record<string, unknown> | null;
    const { esNuevo } = await registrarAviso({
      provider: 'mercadopago',
      eventId: String((cuerpo?.id as string | number | undefined) ?? dataId),
      type: esAutorizacion ? 'preapproval' : 'authorized_payment',
      payload: request.body,
    });
    if (!esNuevo) {
      return reply.status(200).send({ received: true, applied: false, repetido: true });
    }

    // La fuente de verdad es la pasarela, no el cuerpo del aviso: el aviso solo
    // dice "mira esto", y su contenido puede venir incompleto o desordenado.
    const refDeLaSuscripcion = esAutorizacion ? dataId : undefined;
    let sub = refDeLaSuscripcion
      ? await prisma.subscription.findUnique({ where: { providerRef: refDeLaSuscripcion } })
      : null;

    if (esCobro) {
      // El aviso de cobro trae el id del pago; el preapproval viene adentro.
      const preapprovalId = (cuerpo?.data as { id?: string } | undefined)?.id ?? dataId;
      sub = await prisma.subscription.findFirst({
        where: { providerRef: preapprovalId },
      });
    }

    if (!sub) {
      // Aviso legitimo de una suscripcion que no es nuestra (otra aplicacion
      // con la misma cuenta, o una prueba). Se reconoce y se descarta.
      return reply.status(200).send({ received: true, applied: false });
    }

    const enLaPasarela = sub.providerRef
      ? await consultarSuscripcion(sub.providerRef)
      : null;
    if (!enLaPasarela) {
      return reply.status(502).send({ error: 'no pudimos consultar la pasarela' });
    }

    if (esAutorizacion) {
      const estado = mapEstadoSuscripcion(enLaPasarela.status);
      if (estado === 'ACTIVE') {
        await registrarCobro(sub.id, finDelProximoPeriodo());
      } else if (estado === 'PAST_DUE') {
        await registrarCobroFallido(sub.id);
      } else if (estado === 'CANCELED') {
        await cancelar(sub.id);
      }
      return reply.status(200).send({ received: true, applied: estado !== null });
    }

    // Cobro mensual.
    const estadoDelCobro = (cuerpo?.data as { status?: string } | undefined)?.status;
    if (cobroEntro(estadoDelCobro) || enLaPasarela.status === 'authorized') {
      await registrarCobro(sub.id, finDelProximoPeriodo());
    } else {
      await registrarCobroFallido(sub.id);
    }
    invalidateTenantFeatures(sub.tenantId);
    return reply.status(200).send({ received: true, applied: true });
  });
}

/**
 * Aviso del cobro de la configuracion inicial.
 *
 * Endpoint propio y no el de pedidos: aquel busca un `Order` por la referencia
 * externa y este cobro no es un pedido, asi que ahi no encontraria nada.
 */
export async function setupFeeWebhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.post('/webhook/mercadopago/setup', async (request, reply) => {
    const peticion = {
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
      query: request.query as Record<string, string | string[] | undefined>,
    };
    const tipo = extractNotificationType(peticion);
    const dataId = extractDataId(peticion);

    // Solo los cobros mueven esto.
    if (tipo && tipo !== 'payment') {
      return reply.status(200).send({ received: true, applied: false });
    }
    if (!dataId) return reply.status(200).send({ received: true, applied: false });

    if (!env.MERCADOPAGO_WEBHOOK_SECRET) {
      request.log.error('aviso de setup sin MERCADOPAGO_WEBHOOK_SECRET');
      return reply.status(401).send({ error: 'sin verificacion de firma configurada' });
    }
    const firma = verifySignature({
      signatureHeader: request.headers['x-signature'] as string | undefined,
      requestId: request.headers['x-request-id'] as string | undefined,
      dataId,
      secret: env.MERCADOPAGO_WEBHOOK_SECRET,
    });
    if (!firma.valid) {
      request.log.warn({ motivo: firma.reason }, 'aviso de setup con firma invalida');
      return reply.status(401).send({ error: firma.reason });
    }

    // Idempotencia antes de tocar nada: MercadoPago reintenta.
    const { esNuevo } = await registrarAviso({
      provider: 'mercadopago',
      eventId: `setup-${dataId}`,
      type: 'setup_fee',
      payload: request.body,
    });
    if (!esNuevo) {
      return reply.status(200).send({ received: true, applied: false, repetido: true });
    }

    const cobro = await consultarCobro(dataId);
    if (!cobro) return reply.status(200).send({ received: true, applied: false });

    const resultado = await aplicarCobroDeSetup(cobro);
    if (!resultado.aplicado) {
      // No es un error nuestro ni de la pasarela: el cobro llego pero no
      // corresponde. Se registra con el motivo y se reconoce, para que
      // MercadoPago no insista durante horas.
      request.log.warn(
        { motivo: resultado.motivo, tenantId: cobro.tenantId, montoCents: cobro.montoCents },
        'cobro de setup no aplicado',
      );
      return reply.status(200).send({ received: true, applied: false, motivo: resultado.motivo });
    }

    return reply.status(200).send({ received: true, applied: true, yaEstaba: resultado.yaEstaba });
  });
}

export { graciaVencida };
