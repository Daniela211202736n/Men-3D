/**
 * Backoffice — operacion del turno: pedidos, KDS en vivo y moderacion de reseñas.
 */
import {
  KDS_COLUMNS,
  orderStatusUpdateSchema,
  reviewModerationSchema,
} from '@men3d/shared';
import type { FastifyInstance } from 'fastify';

import { notFound } from '../../lib/errors.js';
import { toReviewDto } from '../../lib/serialize.js';
import { prisma } from '../../prisma.js';
import { listOrders, updateOrderStatus } from '../orders/service.js';

/** Cuanto tiempo queda visible un pedido ya servido en el tablero. */
const SERVED_WINDOW_HOURS = 3;

export default async function adminOperationsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ------------------------------------------------------------- pedidos
  app.get('/orders', async (request) => {
    const { tenantId } = request.authUser!;
    const raw = request.query as { status?: string; limit?: string };
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });

    return listOrders(tenantId, tenant.currency, {
      statuses: raw.status ? raw.status.split(',') : undefined,
      limit: raw.limit ? Number(raw.limit) : 50,
    });
  });

  /**
   * Tablero del KDS. Las columnas vivas (por pagar, en cocina, listo) van
   * completas; la de servidos se acota a las ultimas horas y a 20 tickets:
   * una cocina necesita ver el turno, no el historico entero del mes.
   */
  app.get('/kds/board', async (request) => {
    const { tenantId } = request.authUser!;
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });

    const liveStatuses = KDS_COLUMNS.filter((s) => s !== 'SERVED');
    const servedSince = new Date(Date.now() - SERVED_WINDOW_HOURS * 3600 * 1000);

    const [live, served] = await Promise.all([
      listOrders(tenantId, tenant.currency, {
        statuses: [...liveStatuses],
        limit: 200,
      }),
      listOrders(tenantId, tenant.currency, {
        statuses: ['SERVED'],
        since: servedSince,
        limit: 20,
      }),
    ]);

    const orders = [...live, ...served];
    return {
      servedWindowHours: SERVED_WINDOW_HOURS,
      columns: KDS_COLUMNS.map((status) => ({
        status,
        orders: orders.filter((o) => o.status === status),
      })),
    };
  });

  /**
   * Ticket de un minuto para abrir el stream SSE.
   *
   * `EventSource` no permite mandar cabeceras, asi que el token tiene que viajar
   * en la URL — y una URL termina en logs de proxy, en el historial y en el
   * `Referer`. Por eso no se expone el token de sesion (12 h) sino este ticket:
   * dura 60 segundos, solo sirve para leer el stream de este tenant y no
   * autoriza ninguna otra ruta.
   */
  app.post('/kds/ticket', async (request) => {
    const auth = request.authUser!;
    const ticket = app.jwt.sign(
      {
        sub: auth.sub,
        tenantId: auth.tenantId,
        role: auth.role,
        email: auth.email,
        scope: 'kds' as const,
      },
      { expiresIn: '60s' },
    );
    return { ticket, expiresInSeconds: 60 };
  });

  app.patch('/orders/:id/status', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const { status } = orderStatusUpdateSchema.parse(request.body);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });
    return updateOrderStatus(tenantId, tenant.currency, id, status);
  });

  // ------------------------------------------------------------- reseñas
  app.get('/reviews', async (request) => {
    const { tenantId } = request.authUser!;
    const raw = request.query as { status?: string; limit?: string };
    const reviews = await prisma.review.findMany({
      where: { tenantId, ...(raw.status ? { status: raw.status } : {}) },
      include: { dish: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(raw.limit ?? 50), 200),
    });
    return reviews.map(toReviewDto);
  });

  /** Publicar/ocultar una reseña y responderla publicamente. */
  app.patch('/reviews/:id', async (request) => {
    const { tenantId } = request.authUser!;
    const { id } = request.params as { id: string };
    const input = reviewModerationSchema.parse(request.body);

    const result = await prisma.review.updateMany({
      where: { id, tenantId },
      data: {
        status: input.status,
        ...(input.reply !== undefined ? { reply: input.reply } : {}),
      },
    });
    if (result.count === 0) throw notFound('Reseña');

    const review = await prisma.review.findUniqueOrThrow({
      where: { id },
      include: { dish: { select: { id: true, name: true } } },
    });
    return toReviewDto(review);
  });
}
