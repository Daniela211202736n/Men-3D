/**
 * Datos del comensal: ver lo que hay y pedir que se borre.
 *
 * El comensal no tiene cuenta. Lo identifica un `guestId` opaco que vive en su
 * navegador, asi que todo lo de aca se resuelve con ese id y el restaurante en
 * el que esta: los datos de un local no se mezclan con los de otro ni siquiera
 * para el mismo dispositivo.
 *
 * **La decision que importa: borrar no borra los pedidos, los anonimiza.**
 *
 * Un pedido es un comprobante de venta. El restaurante lo necesita para su
 * contabilidad y en muchos lados esta obligado a conservarlo por años; si un
 * comensal pudiera hacerlo desaparecer, le estariamos rompiendo los libros a
 * nuestro cliente. Lo que si se va es todo lo que señala a una persona —nombre,
 * telefono, email, el vinculo con el dispositivo— y queda la transaccion:
 * fecha, platos, importes. Eso es lo que pide la ley y lo que el restaurante
 * necesita, a la vez.
 *
 * Lo que se borra de verdad, porque no es un comprobante de nada: su cuenta de
 * puntos y sus opiniones.
 *
 * **La analitica no aparece ni en la exportacion ni en el borrado, y no es un
 * olvido.** Los eventos se guardan contra un `sessionId` —una visita de treinta
 * minutos— y no hay ninguna columna, en ninguna tabla, que ate ese id al
 * `guestId` del dispositivo. No es que no la busquemos: no existe forma de
 * saber cuales de esos eventos son de quien pregunta, ni para nosotros ni para
 * el restaurante. Que ese vinculo no exista es el motivo por el que la
 * analitica es anonima de verdad y no "anonimizada". Si alguna vez se agrega
 * esa columna, hay que volver aca: pasaria a ser dato personal.
 */
import { prisma } from '../../prisma.js';

export interface DatosDelComensal {
  restaurante: string;
  guestId: string;
  generadoEl: string;
  explicacion: string;
  pedidos: unknown[];
  opiniones: unknown[];
  puntos: unknown;
  analitica: string;
}

/**
 * Todo lo que el restaurante tiene asociado a este dispositivo.
 *
 * Se devuelve en JSON legible y no en un volcado de la base: el punto es que
 * la persona entienda que hay, no que lo pueda importar en algun lado.
 */
export async function exportarDatos(
  tenantId: string,
  slug: string,
  guestId: string,
): Promise<DatosDelComensal> {
  const [pedidos, opiniones, cuenta] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, guestId },
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { nameSnapshot: true, quantity: true, unitPriceCents: true } } },
    }),
    prisma.review.findMany({
      where: { tenantId, guestId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, rating: true, comment: true, authorName: true, createdAt: true, dishId: true },
    }),
    prisma.loyaltyAccount.findUnique({
      where: { tenantId_guestId: { tenantId, guestId } },
      include: { ledger: { orderBy: { createdAt: 'desc' } } },
    }),
  ]);

  return {
    restaurante: slug,
    guestId,
    generadoEl: new Date().toISOString(),
    explicacion:
      'Esto es todo lo que este restaurante tiene asociado a tu dispositivo. ' +
      'No hay cuenta ni perfil: te identifica un codigo al azar guardado en tu ' +
      'navegador, que desaparece si borras los datos del sitio.',
    pedidos,
    opiniones,
    puntos: cuenta
      ? { saldo: cuenta.balance, acumuladoHistorico: cuenta.lifetimePoints, movimientos: cuenta.ledger }
      : null,
    analitica:
      'No figura, y no es un olvido: los eventos de uso se guardan contra un ' +
      'codigo de visita que no esta vinculado a tu dispositivo en ninguna ' +
      'tabla. Ni el restaurante ni nosotros podemos saber cuales son tuyos. ' +
      'Si no queres que se registren, podes rechazarlos desde esta misma ' +
      'pantalla.',
  };
}

export interface ResultadoDelBorrado {
  pedidosAnonimizados: number;
  opinionesBorradas: number;
  cuentaDePuntosBorrada: boolean;
}

/** Borra lo que se puede borrar y anonimiza lo que hay que conservar. */
export async function borrarDatos(
  tenantId: string,
  guestId: string,
): Promise<ResultadoDelBorrado> {
  const [anonimizados, opiniones, cuenta] = await prisma.$transaction([
    // El comprobante queda; lo que señala a una persona, no. `guestId` tambien
    // se va: si quedara, el pedido seguiria atado al dispositivo y el borrado
    // seria de mentira.
    prisma.order.updateMany({
      where: { tenantId, guestId },
      data: {
        customerName: null,
        customerPhone: null,
        customerEmail: null,
        guestId: null,
        notes: null,
      },
    }),
    // Una opinion es de quien la escribio: se va entera.
    prisma.review.deleteMany({ where: { tenantId, guestId } }),
    // Los puntos se pierden, y hay que decirselo antes de que confirme.
    prisma.loyaltyAccount.deleteMany({ where: { tenantId, guestId } }),
  ]);

  return {
    pedidosAnonimizados: anonimizados.count,
    opinionesBorradas: opiniones.count,
    cuentaDePuntosBorrada: cuenta.count > 0,
  };
}
