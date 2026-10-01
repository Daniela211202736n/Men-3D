import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Error de negocio con codigo estable que el frontend puede discriminar. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST') =>
  new AppError(400, code, msg);
export const unauthorized = (msg = 'Credenciales invalidas') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'No tenes permiso para esta accion') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Recurso') =>
  new AppError(404, 'NOT_FOUND', `${what} no encontrado`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);

/**
 * Traduce cualquier excepcion a la forma `ApiErrorDto`. Los 5xx se registran
 * completos pero al cliente solo le llega un mensaje genarico: los detalles de
 * un fallo interno no son suyos.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      }

      if (error instanceof ZodError) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Los datos enviados no son validos',
            details: error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        });
      }

      // Errores que Fastify ya tipifica (rate limit, body malformado, JWT...).
      const fastifyError = error as { statusCode?: number; code?: string; message?: string };
      if (fastifyError?.statusCode && fastifyError.statusCode < 500) {
        return reply.status(fastifyError.statusCode).send({
          error: {
            code: fastifyError.code ?? 'REQUEST_ERROR',
            message: fastifyError.message ?? 'Request invalido',
          },
        });
      }

      request.log.error({ err: error }, 'error no manejado');
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
      });
    },
  );

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Ruta inexistente: ${request.method} ${request.url}`,
      },
    }),
  );
}
