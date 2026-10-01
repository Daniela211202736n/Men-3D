/**
 * Stream SSE del tablero de cocina.
 *
 * Vive aparte del resto del backoffice porque se autentica distinto: con el
 * ticket de corta vida que emite `POST /api/admin/kds/ticket`, no con el token
 * de sesion. Asi el token de 12 h nunca aparece en una URL.
 */
import type { FastifyInstance } from 'fastify';

import { unauthorized } from '../../lib/errors.js';
import type { AuthPayload } from '../../plugins/auth.js';
import { kdsHub } from './kds.js';

/** Latido cada 25 s: nginx corta conexiones ociosas a los 60 s por defecto. */
const HEARTBEAT_MS = 25_000;

export default async function kdsStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/kds/stream', async (request, reply) => {
    const { ticket } = request.query as { ticket?: string };
    if (!ticket) throw unauthorized('Falta el ticket del stream');

    let payload: AuthPayload;
    try {
      payload = app.jwt.verify<AuthPayload>(ticket);
    } catch {
      throw unauthorized('Ticket vencido o invalido');
    }
    // Un token de sesion normal no sirve aca: el alcance tiene que ser el del
    // ticket, para que un token filtrado en un log no abra nada mas.
    if (payload.scope !== 'kds') throw unauthorized('El ticket no es valido para el KDS');

    const tenantId = payload.tenantId;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita que un proxy intermedio acumule la respuesta en un buffer.
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': conectado al stream del KDS\n\n');

    const unsubscribe = kdsHub.subscribe(tenantId, (event) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event.order)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    // La respuesta queda abierta a proposito: no se llama a `reply.send`.
    return reply;
  });
}
