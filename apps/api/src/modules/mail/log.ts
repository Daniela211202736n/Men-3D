/**
 * Driver `log`: imprime el correo en la consola del servidor.
 *
 * No es un sustituto silencioso. Imprime el cuerpo completo justamente para que
 * el enlace de recuperacion sea usable en desarrollo, y avisa en produccion de
 * que ningun correo esta saliendo de verdad.
 */
import { isProduction } from '../../env.js';
import type { MailConfiguration, MailMessage, MailProvider } from './provider.js';

export class LogMail implements MailProvider {
  readonly name = 'log' as const;

  async send(message: MailMessage): Promise<void> {
    const aviso = isProduction
      ? ' !! MAIL_DRIVER=log en produccion: este correo NO se envio !!'
      : '';
    console.info(
      [
        `\n--- correo (driver log)${aviso}`,
        `  para:    ${message.to}`,
        `  asunto:  ${message.subject}`,
        '  cuerpo:',
        message.text
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n'),
        '---\n',
      ].join('\n'),
    );
  }

  describeConfiguration(): MailConfiguration {
    return {
      ready: true,
      missing: [],
      details: { driver: 'log', actuallySends: false },
    };
  }
}
