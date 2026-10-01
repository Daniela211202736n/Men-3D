/**
 * Envio de correo detras de una interfaz, como los pagos y el almacenamiento.
 *
 * Dos drivers:
 *
 *   `log`    — escribe el mensaje en la consola del servidor. No necesita
 *              credenciales, asi que el flujo de recuperacion de contraseña se
 *              puede recorrer entero en desarrollo: el enlace sale en el log.
 *   `resend` — envia de verdad por HTTP. Se eligio Resend porque su API es una
 *              sola llamada y no agrega dependencias.
 *
 * SMTP no esta: necesitaria nodemailer, y para dos correos transaccionales no
 * justifica la dependencia. Agregarlo es un archivo nuevo.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Cuerpo en texto plano. Es el que importa: llega a todos lados. */
  text: string;
  /** Cuerpo HTML opcional. */
  html?: string;
}

export interface MailConfiguration {
  ready: boolean;
  missing: string[];
  details: Record<string, boolean | string>;
}

export interface MailProvider {
  readonly name: 'log' | 'resend';
  send(message: MailMessage): Promise<void>;
  describeConfiguration(): MailConfiguration;
}
