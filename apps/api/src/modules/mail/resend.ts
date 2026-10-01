/**
 * Driver `resend`: envio real por HTTP.
 *
 * Sin SDK: la API es un POST con JSON, y `fetch` ya viene en Node.
 */
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import type { MailConfiguration, MailMessage, MailProvider } from './provider.js';

const ENDPOINT = 'https://api.resend.com/emails';

export class ResendMail implements MailProvider {
  readonly name = 'resend' as const;

  async send(message: MailMessage): Promise<void> {
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
      throw new AppError(
        503,
        'MAIL_NOT_CONFIGURED',
        'Faltan RESEND_API_KEY o MAIL_FROM para poder enviar correo.',
      );
    }

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
    } catch (error) {
      throw new AppError(
        502,
        'MAIL_SEND_FAILED',
        `No se pudo contactar al servicio de correo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      // El cuerpo del error trae el motivo (dominio sin verificar, clave
      // invalida); se registra pero no se devuelve al cliente.
      const detalle = await response.text().catch(() => '');
      console.error(`[mail:resend] ${response.status}: ${detalle.slice(0, 300)}`);
      throw new AppError(
        502,
        'MAIL_SEND_FAILED',
        'El servicio de correo rechazo el envio.',
      );
    }
  }

  describeConfiguration(): MailConfiguration {
    const missing: string[] = [];
    if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (!env.MAIL_FROM) missing.push('MAIL_FROM');
    return {
      ready: missing.length === 0,
      missing,
      details: { driver: 'resend', from: env.MAIL_FROM ?? 'sin definir' },
    };
  }
}
