/**
 * Pruebas A/B de carta: dos descripciones, o dos precios, para el mismo plato.
 *
 * **La regla que manda sobre todas las demas: el comensal paga el precio que
 * vio.** Si la carta le mostro $5.900 y el pedido se liquida a $6.900, no es un
 * experimento mal medido, es un cobro indebido. Por eso:
 *
 *  - La asignacion es **deterministica a partir del `guestId`**, no al azar y no
 *    guardada en una tabla. La misma persona, en el mismo restaurante, ve
 *    siempre lo mismo: al recargar, al volver mañana, y —lo que importa— al
 *    confirmar el pedido.
 *  - El mismo `aplicarVariantes()` que usa la carta publica lo usa
 *    `createOrder` para poner el precio. No hay dos caminos que puedan
 *    divergir, porque es una sola funcion.
 *  - Sin `guestId` no hay experimento: se sirve A, que es lo que dice el plato
 *    en la base. Es la unica respuesta segura cuando no hay con que asignar.
 *
 * **Por que `guestId` y no el `sessionId` de la analitica.** La sesion dura
 * treinta minutos y el carrito sobrevive a la recarga: con la sesion como
 * unidad, a alguien que vuelve a los cuarenta minutos a confirmar su pedido le
 * cambiaria el precio en la cara. El dispositivo es la unidad correcta.
 *
 * La variante A nunca se guarda: A es lo que dice el plato. Si el restaurante
 * cambia el precio en medio de la prueba, el control lo sigue solo.
 */
import { createHash } from 'node:crypto';

import { ExperimentField, Variant } from '@men3d/shared';

import { prisma } from '../../prisma.js';

/** Lo que hace falta saber de un experimento para aplicarlo. */
export interface ExperimentoActivo {
  id: string;
  dishId: string;
  field: string;
  valueB: string;
}

/** Que le toco a este dispositivo en este experimento. */
export interface Asignacion {
  experimentId: string;
  variant: Variant;
}

/**
 * La variante de un dispositivo, deterministica y estable para siempre.
 *
 * Se mezcla el id del experimento con el `guestId` a proposito: si se usara
 * solo el guestId, el mismo dispositivo caeria en el mismo lado en TODOS los
 * experimentos del restaurante, y los sesgos de esa mitad de la gente se
 * acumularian prueba tras prueba.
 *
 * SHA-1 y no un hash casero: la distribucion importa. Un `charCodeAt` sumado
 * reparte mal con ids que comparten prefijo, y los cuid que genera Prisma
 * comparten prefijo.
 */
export function varianteDe(guestId: string, experimentId: string): Variant {
  const digest = createHash('sha1').update(`${experimentId}:${guestId}`).digest();
  return (digest[0]! & 1) === 0 ? Variant.A : Variant.B;
}

/** Los experimentos corriendo de un restaurante, por plato. */
export async function experimentosActivos(
  tenantId: string,
): Promise<Map<string, ExperimentoActivo>> {
  const filas = await prisma.experiment.findMany({
    where: { tenantId, status: 'RUNNING' },
    select: { id: true, dishId: true, field: true, valueB: true },
  });
  return new Map(filas.map((f) => [f.dishId, f]));
}

/** Lo que un experimento cambia de un plato. Solo lo que cambia. */
export interface Desvio {
  description?: string;
  priceCents?: number;
}

/**
 * Que ve este dispositivo de este plato.
 *
 * Devuelve `null` cuando no hay nada que cambiar —no hay experimento, no hay
 * guestId, o le toco A—, para que quien llama no tenga que distinguir casos.
 */
export function desvioPara(
  experimento: ExperimentoActivo | undefined,
  guestId: string | null | undefined,
): { desvio: Desvio; asignacion: Asignacion } | null {
  if (!experimento || !guestId) return null;

  const variant = varianteDe(guestId, experimento.id);
  const asignacion = { experimentId: experimento.id, variant };
  if (variant === Variant.A) return { desvio: {}, asignacion };

  if (experimento.field === ExperimentField.PRICE) {
    const centavos = Number.parseInt(experimento.valueB, 10);
    // Un valueB corrupto no puede cambiar un precio. Se sirve A y se avisa:
    // callarse aca es cobrar cualquier cosa.
    if (!Number.isInteger(centavos) || centavos < 0) {
      console.error(
        `[experimentos] ${experimento.id} tiene un precio invalido ("${experimento.valueB}"): se sirve A`,
      );
      return { desvio: {}, asignacion: { experimentId: experimento.id, variant: Variant.A } };
    }
    return { desvio: { priceCents: centavos }, asignacion };
  }

  return { desvio: { description: experimento.valueB }, asignacion };
}

/** Un plato con lo que el experimento necesita leer y escribir. */
export interface PlatoVariable {
  id: string;
  description?: string | null;
  priceCents: number;
}

/**
 * Aplica los desvios a una lista de platos, **en copias**.
 *
 * No muta lo que vino de Prisma: el mismo objeto puede estar en una cache o
 * usarse despues para otra cosa, y un precio pisado en memoria es exactamente
 * el error que esta funcion existe para no cometer.
 *
 * Devuelve tambien que variante le toco a cada plato, que es lo que el cliente
 * manda de vuelta con los eventos de analitica para poder partir el embudo.
 */
export function aplicarVariantes<T extends PlatoVariable>(
  platos: T[],
  experimentos: Map<string, ExperimentoActivo>,
  guestId: string | null | undefined,
): { platos: T[]; asignaciones: Record<string, Variant> } {
  if (experimentos.size === 0 || !guestId) return { platos, asignaciones: {} };

  const asignaciones: Record<string, Variant> = {};
  const salida = platos.map((plato) => {
    const resultado = desvioPara(experimentos.get(plato.id), guestId);
    if (!resultado) return plato;

    asignaciones[plato.id] = resultado.asignacion.variant;
    const { desvio } = resultado;
    if (desvio.description === undefined && desvio.priceCents === undefined) return plato;

    return {
      ...plato,
      ...(desvio.description !== undefined ? { description: desvio.description } : {}),
      ...(desvio.priceCents !== undefined ? { priceCents: desvio.priceCents } : {}),
    };
  });

  return { platos: salida, asignaciones };
}
