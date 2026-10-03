/**
 * Correo de confirmacion al comensal.
 *
 * Se manda cuando el pedido queda pagado de verdad, por los dos caminos que
 * llevan ahi: el cobro inmediato y el aviso de la pasarela.
 *
 * Tres decisiones:
 *
 *  - **Solo si dejo un email.** Quien come en el local muchas veces no deja
 *    ninguno, y esta bien: el seguimiento lo tiene en la pantalla. Pedirle un
 *    correo para poder pedir seria pedir un dato que no necesitamos.
 *
 *  - **Se despacha sin esperarlo.** Igual que el de recuperacion: el pedido ya
 *    esta pagado y la cocina ya lo recibio; que el correo tarde o falle no
 *    puede demorar la respuesta ni, mucho menos, hacerla fallar. Un fallo
 *    queda en el log.
 *
 *  - **En el idioma en que pidio.** El pedido guarda su `locale`. Mandarle el
 *    correo en español a alguien que recorrio la carta en ingles es tirar por
 *    la borda la traduccion automatica justo en el ultimo paso.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from '@men3d/shared';
import type { Order, OrderItem } from '@prisma/client';

import { env } from '../../env.js';
import { getMailer } from '../mail/index.js';

interface Textos {
  asunto: (code: string) => string;
  saludo: (nombre: string | null) => string;
  confirmado: (local: string) => string;
  detalle: string;
  total: string;
  seguimiento: string;
  mesa: (mesa: string) => string;
  puntos: (n: number) => string;
  cierre: string;
}

/**
 * Los textos viven aca y no en el diccionario de la PWA a proposito: un correo
 * no se lee en la misma situacion que una pantalla —llega despues, fuera de
 * contexto, y hay que repetir cosas que en la pantalla sobran, como de que
 * local es el pedido.
 */
const TEXTOS: Record<string, Textos> = {
  es: {
    asunto: (code) => `Tu pedido ${code}`,
    saludo: (nombre) => (nombre ? `Hola ${nombre},` : 'Hola,'),
    confirmado: (local) => `Tu pedido en ${local} esta confirmado y ya paso a cocina.`,
    detalle: 'Lo que pediste',
    total: 'Total',
    seguimiento: 'Segui el estado de tu pedido en vivo:',
    mesa: (mesa) => `Mesa ${mesa}`,
    puntos: (n) => `Sumaste ${n} puntos para tu proxima visita.`,
    cierre: 'Gracias por tu pedido.',
  },
  en: {
    asunto: (code) => `Your order ${code}`,
    saludo: (nombre) => (nombre ? `Hi ${nombre},` : 'Hi,'),
    confirmado: (local) => `Your order at ${local} is confirmed and on its way to the kitchen.`,
    detalle: 'What you ordered',
    total: 'Total',
    seguimiento: 'Follow your order live:',
    mesa: (mesa) => `Table ${mesa}`,
    puntos: (n) => `You earned ${n} points for your next visit.`,
    cierre: 'Thanks for your order.',
  },
  pt: {
    asunto: (code) => `Seu pedido ${code}`,
    saludo: (nombre) => (nombre ? `Ola ${nombre},` : 'Ola,'),
    confirmado: (local) => `Seu pedido no ${local} esta confirmado e ja foi para a cozinha.`,
    detalle: 'O que voce pediu',
    total: 'Total',
    seguimiento: 'Acompanhe seu pedido ao vivo:',
    mesa: (mesa) => `Mesa ${mesa}`,
    puntos: (n) => `Voce ganhou ${n} pontos para a proxima visita.`,
    cierre: 'Obrigado pelo seu pedido.',
  },
};

function textosDe(locale: string | null | undefined): Textos {
  const elegido = locale && isLocale(locale) ? locale : DEFAULT_LOCALE;
  // Los idiomas sin texto propio caen al ingles, no al español: es la eleccion
  // que mas gente entiende entre quienes no hablan ninguno de los tres.
  return TEXTOS[elegido] ?? TEXTOS.en!;
}

function formatearImporte(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * El pedido tal como esta en la base, no su DTO.
 *
 * `OrderDto` no expone el email del comensal ni el idioma, y no hay que
 * ensancharlo para esto: ese DTO lo devuelve la pantalla de seguimiento, que
 * cualquiera con el codigo del pedido puede abrir. Agregarle el email para
 * comodidad nuestra seria publicarlo.
 */
export type PedidoParaCorreo = Order & { items: OrderItem[] };

export interface ConfirmacionInput {
  order: PedidoParaCorreo;
  nombreDelLocal: string;
  slug: string;
  currency: string;
}

/** Arma el cuerpo. Separado del envio para poder probarlo sin tocar el correo. */
export function armarConfirmacion(input: ConfirmacionInput): {
  to: string;
  subject: string;
  text: string;
} | null {
  const { order } = input;
  if (!order.customerEmail) return null;

  const locale = (order.locale && isLocale(order.locale) ? order.locale : DEFAULT_LOCALE) as Locale;
  const t = textosDe(order.locale);
  const importe = (cents: number) => formatearImporte(cents, input.currency, locale);

  const enlace = new URL(
    `/m/${input.slug}/pedido/${order.code}`,
    env.PUBLIC_WEB_URL,
  ).toString();

  const lineas = [
    t.saludo(order.customerName ?? null),
    '',
    t.confirmado(input.nombreDelLocal),
    ...(order.tableLabel ? [t.mesa(order.tableLabel)] : []),
    '',
    `${t.detalle}:`,
    ...order.items.map(
      (i) => `  ${i.quantity}x ${i.nameSnapshot} — ${importe(i.unitPriceCents * i.quantity)}`,
    ),
    '',
    `${t.total}: ${importe(order.totalCents)}`,
    '',
    t.seguimiento,
    enlace,
    ...(order.pointsEarned > 0 ? ['', t.puntos(order.pointsEarned)] : []),
    '',
    t.cierre,
  ];

  return {
    to: order.customerEmail,
    subject: t.asunto(order.code),
    text: lineas.join('\n'),
  };
}

/**
 * Despacha la confirmacion. No espera ni propaga: el pedido ya esta pagado.
 */
export function enviarConfirmacion(input: ConfirmacionInput): void {
  const mensaje = armarConfirmacion(input);
  // Sin email no hay nada que mandar, y no es un error: comer en el local sin
  // dejar un correo es lo normal.
  if (!mensaje) return;

  void getMailer()
    .send(mensaje)
    .catch((error: unknown) => {
      console.error(
        '[mail] fallo el correo de confirmacion del pedido',
        input.order.code,
        error instanceof Error ? error.message : error,
      );
    });
}
