import { env } from '../../env.js';
import { LogMail } from './log.js';
import { ResendMail } from './resend.js';
import type { MailProvider } from './provider.js';

let instance: MailProvider | null = null;

export function getMailer(): MailProvider {
  instance ??= env.MAIL_DRIVER === 'resend' ? new ResendMail() : new LogMail();
  return instance;
}

/**
 * Sustituye el proveedor. Existe para las pruebas: una de ellas necesita un
 * envio que nunca termina, para comprobar que la respuesta no lo espera.
 * Pasar `null` vuelve al proveedor que diga el entorno.
 */
export function setMailer(provider: MailProvider | null): void {
  instance = provider;
}

export * from './provider.js';
export { LogMail, ResendMail };
