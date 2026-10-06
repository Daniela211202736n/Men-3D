/**
 * Boton de arrepentimiento (Resolucion 424/2020 SCI).
 *
 * La norma obliga a quien vende por web a publicar un enlace de revocacion, y
 * es especifica en tres cosas que condicionan el diseño:
 *
 *  1. **Acceso directo desde la portada**, destacado por tamaño y visibilidad.
 *  2. **No se le puede exigir registrarse ni hacer ningun otro tramite.** Por
 *     eso no hay sesion, no hay tenantId y los campos que identifican la
 *     contratacion son opcionales: pedirle el numero de operacion a alguien que
 *     quiere arrepentirse es el tramite que la norma no permite pedir.
 *  3. **Informarle el codigo de revocacion dentro de las 24 horas, por el mismo
 *     medio.**
 *
 * Lo tercero se resuelve de la forma mas segura posible: el codigo se le
 * devuelve en la misma respuesta y se le muestra en pantalla —mismo medio, cero
 * horas— y ademas se le manda por correo. Si el correo falla, la persona ya
 * tiene su codigo y el pedido ya esta guardado; `notifiedAt` queda en null y
 * eso se ve en la base.
 *
 * Lo que esto NO hace: dar de baja la suscripcion ni devolver la plata. Eso lo
 * decide y lo ejecuta una persona —la baja desde el panel, el reintegro desde
 * MercadoPago— porque hay que mirar que se contrato y cuando. El aviso a
 * LEGAL_EMAIL es lo que pone a esa persona en movimiento.
 */
import { randomInt } from 'node:crypto';

import { env } from '../../env.js';
import { getMailer } from '../mail/index.js';
import { prisma } from '../../prisma.js';

/** Sin caracteres ambiguos: este codigo se dicta por telefono. */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LARGO = 8;
const INTENTOS = 5;

export interface PedidoDeRevocacion {
  name: string;
  email: string;
  phone?: string;
  reference?: string;
  detail?: string;
}

export interface RevocacionRegistrada {
  code: string;
  createdAt: Date;
}

function nuevoCodigo(): string {
  let salida = '';
  for (let i = 0; i < LARGO; i += 1) salida += ALFABETO[randomInt(ALFABETO.length)];
  return `ARR-${salida}`;
}

/**
 * Guarda el pedido con su codigo.
 *
 * Reintenta ante choque de codigo: son 32^8 combinaciones, asi que no va a
 * pasar, pero un unique que falla sin reintento convierte un imposible en un
 * error 500 para alguien que esta ejerciendo un derecho.
 */
export async function registrarPedido(
  input: PedidoDeRevocacion,
): Promise<RevocacionRegistrada> {
  for (let intento = 0; intento < INTENTOS; intento += 1) {
    try {
      const fila = await prisma.revocationRequest.create({
        data: {
          code: nuevoCodigo(),
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          reference: input.reference ?? null,
          detail: input.detail ?? null,
        },
      });
      return { code: fila.code, createdAt: fila.createdAt };
    } catch (error) {
      const choque =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002';
      if (!choque || intento === INTENTOS - 1) throw error;
    }
  }
  // Inalcanzable: el bucle devuelve o lanza.
  throw new Error('no se pudo generar un codigo de revocacion');
}

/** Texto del correo al consumidor. Es el comprobante de que ejercio el derecho. */
function cuerpoParaElConsumidor(code: string, nombre: string): string {
  return [
    `Hola ${nombre},`,
    '',
    'Recibimos tu pedido de revocacion de la contratacion.',
    '',
    `Tu codigo de identificacion es: ${code}`,
    '',
    'Guardalo: es el comprobante de que ejerciste tu derecho de arrepentimiento,',
    'con la fecha de este correo. Vamos a dar de baja el servicio y, si',
    'correspondiera un reintegro, lo procesamos por el mismo medio de pago.',
    '',
    'Si necesitas agregar algo, respondé este correo citando el codigo.',
  ].join('\n');
}

/** Texto del aviso interno. Lleva todo lo que hace falta para actuar. */
function cuerpoParaLaEmpresa(
  code: string,
  input: PedidoDeRevocacion,
  cuando: Date,
): string {
  return [
    'Entro un pedido por el boton de arrepentimiento.',
    '',
    `Codigo:     ${code}`,
    `Fecha:      ${cuando.toISOString()}`,
    `Nombre:     ${input.name}`,
    `Correo:     ${input.email}`,
    `Telefono:   ${input.phone ?? '(no dejo)'}`,
    `Referencia: ${input.reference ?? '(no dejo)'}`,
    '',
    'Detalle:',
    input.detail ?? '(no dejo)',
    '',
    'La Res. 424/2020 da 24 horas para informarle el codigo: ya se hizo, en',
    'pantalla y por correo. Lo que queda es honrar la revocacion —baja y, si',
    'corresponde, reintegro— y eso no lo hace el sistema.',
  ].join('\n');
}

/**
 * Avisa por correo: al consumidor su codigo, y a la empresa que actue.
 *
 * No se espera desde la ruta: la persona ya tiene el codigo en pantalla y el
 * pedido ya esta en la base, asi que un proveedor de correo lento no tiene por
 * que hacerla esperar. Un fallo se registra y deja `notifiedAt` en null.
 */
export async function avisar(
  registro: RevocacionRegistrada,
  input: PedidoDeRevocacion,
): Promise<void> {
  const mailer = getMailer();

  try {
    await mailer.send({
      to: input.email,
      subject: `Tu codigo de revocacion: ${registro.code}`,
      text: cuerpoParaElConsumidor(registro.code, input.name),
    });
    await prisma.revocationRequest.update({
      where: { code: registro.code },
      data: { notifiedAt: new Date() },
    });
  } catch (error) {
    console.error(
      `[arrepentimiento] no se pudo avisar al consumidor de ${registro.code}:`,
      error,
    );
  }

  if (!env.LEGAL_EMAIL) {
    console.warn(
      `[arrepentimiento] ${registro.code} quedo sin avisar a nadie: falta LEGAL_EMAIL. ` +
        'El pedido esta guardado, pero nadie se va a enterar hasta que alguien mire la base.',
    );
    return;
  }

  try {
    await mailer.send({
      to: env.LEGAL_EMAIL,
      subject: `[arrepentimiento] ${registro.code}`,
      text: cuerpoParaLaEmpresa(registro.code, input, registro.createdAt),
    });
  } catch (error) {
    console.error(`[arrepentimiento] no se pudo avisar a la empresa de ${registro.code}:`, error);
  }
}
