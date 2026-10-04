/**
 * Los numeros de una prueba A/B, y cuando se puede creer en ellos.
 *
 * La parte dificil de esta pantalla no es contar: es **no dejar que el dueño
 * tome una decision de precios con ruido**. Con cincuenta visitas y dos pedidos
 * de diferencia, la variante B "gana" la mitad de las veces por azar. Un
 * informe que muestra dos columnas y una flecha verde hacia la mas grande es
 * peor que no tener informe, porque convence.
 *
 * Asi que hay tres cosas, no una:
 *
 *  1. Las cuentas por variante: vistas, al carrito, pedidos, ingreso.
 *  2. Una prueba de significancia de verdad sobre la conversion (z de dos
 *     proporciones), con su valor p.
 *  3. Un veredicto en castellano que **se niega a opinar** mientras la muestra
 *     no alcance, y que dice cuanto falta.
 *
 * **Y una advertencia que la pantalla repite**: en una prueba de PRECIO la
 * conversion es la metrica equivocada. Subir el precio baja la conversion y
 * puede subir la plata. Lo que decide es el ingreso por visita, que se informa
 * —descriptivo, sin significancia, porque un test sobre una distribucion tan
 * sesgada con estas muestras prometeria una precision que no existe.
 */
import { ExperimentField, Variant } from '@men3d/shared';

import { prisma } from '../../prisma.js';

/** Minimos para animarse a decir algo. Debajo de esto, el veredicto calla. */
const VISTAS_MINIMAS_POR_VARIANTE = 100;
const PEDIDOS_MINIMOS_EN_TOTAL = 10;
/** Dos colas al 5%. */
const Z_CRITICO = 1.96;

export interface NumerosDeVariante {
  variant: Variant;
  /** El valor que vio esta mitad de la gente. */
  valor: string;
  vistas: number;
  alCarrito: number;
  pedidos: number;
  ingresoCents: number;
  /** pedidos / vistas. Null si no hubo vistas. */
  conversion: number | null;
  /** ingreso / vistas, en centavos. Null si no hubo vistas. */
  ingresoPorVistaCents: number | null;
}

export type Veredicto =
  | { clase: 'sin-datos'; mensaje: string }
  | { clase: 'falta-muestra'; mensaje: string; faltanVistas: number }
  | { clase: 'sin-diferencia'; mensaje: string; valorP: number }
  | { clase: 'gana'; mensaje: string; ganadora: Variant; valorP: number };

export interface ResultadoDeExperimento {
  id: string;
  dishId: string;
  dishName: string;
  field: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  winner: string | null;
  variantes: [NumerosDeVariante, NumerosDeVariante];
  veredicto: Veredicto;
  /** La conversion es la metrica equivocada para una prueba de precio. */
  avisoDePrecio: boolean;
}

/** Función de distribución normal acumulada, por la aproximación de Abramowitz y Stegun. */
function normal(z: number): number {
  // erf aproximado con error < 1.5e-7, que para un valor p es de sobra.
  const signo = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + signo * y);
}

/**
 * z de dos proporciones y su valor p a dos colas.
 *
 * Devuelve null cuando no se puede calcular (alguna variante sin vistas, o
 * ninguna conversion en ninguna de las dos).
 */
export function pruebaDeProporciones(
  exitos1: number,
  n1: number,
  exitos2: number,
  n2: number,
): { z: number; valorP: number } | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = exitos1 / n1;
  const p2 = exitos2 / n2;
  const combinada = (exitos1 + exitos2) / (n1 + n2);
  if (combinada <= 0 || combinada >= 1) return null;

  const error = Math.sqrt(combinada * (1 - combinada) * (1 / n1 + 1 / n2));
  if (error === 0) return null;

  const z = (p1 - p2) / error;
  return { z, valorP: 2 * (1 - normal(Math.abs(z))) };
}

function pesos(centavos: number): string {
  return `$${Math.round(centavos / 100).toLocaleString('es-AR')}`;
}

/** El veredicto, que se niega a opinar si la muestra no alcanza. */
export function veredictoDe(
  a: NumerosDeVariante,
  b: NumerosDeVariante,
): Veredicto {
  if (a.vistas === 0 && b.vistas === 0) {
    return {
      clase: 'sin-datos',
      mensaje: 'Todavia no hubo visitas: la prueba no empezo a medir.',
    };
  }

  const minimo = Math.min(a.vistas, b.vistas);
  const pedidos = a.pedidos + b.pedidos;
  if (minimo < VISTAS_MINIMAS_POR_VARIANTE || pedidos < PEDIDOS_MINIMOS_EN_TOTAL) {
    const faltanVistas = Math.max(0, VISTAS_MINIMAS_POR_VARIANTE - minimo);
    return {
      clase: 'falta-muestra',
      mensaje:
        faltanVistas > 0
          ? `Falta muestra: ${faltanVistas} vista(s) mas en la variante con menos. ` +
            'Con estos numeros cualquier diferencia es ruido.'
          : `Falta muestra: ${PEDIDOS_MINIMOS_EN_TOTAL - pedidos} pedido(s) mas entre las dos. ` +
            'Con estos numeros cualquier diferencia es ruido.',
      faltanVistas,
    };
  }

  const prueba = pruebaDeProporciones(a.pedidos, a.vistas, b.pedidos, b.vistas);
  if (!prueba) {
    return {
      clase: 'sin-datos',
      mensaje: 'No se puede comparar: ninguna de las dos variantes tuvo pedidos.',
    };
  }

  if (Math.abs(prueba.z) < Z_CRITICO) {
    return {
      clase: 'sin-diferencia',
      mensaje:
        `No hay diferencia que se pueda distinguir del azar (p = ${prueba.valorP.toFixed(2)}). ` +
        'Dejala correr mas, o aceptá que las dos funcionan igual.',
      valorP: prueba.valorP,
    };
  }

  const ganadora = prueba.z > 0 ? a : b;
  const perdedora = prueba.z > 0 ? b : a;
  return {
    clase: 'gana',
    ganadora: ganadora.variant,
    valorP: prueba.valorP,
    mensaje:
      `Gana ${ganadora.variant} en conversion: ${(ganadora.conversion! * 100).toFixed(1)}% ` +
      `contra ${(perdedora.conversion! * 100).toFixed(1)}% (p = ${prueba.valorP.toFixed(3)}). ` +
      `Ingreso por visita: ${pesos(ganadora.ingresoPorVistaCents ?? 0)} contra ` +
      `${pesos(perdedora.ingresoPorVistaCents ?? 0)}.`,
  };
}

/** Los numeros de un experimento, de la base. */
export async function resultadosDe(
  tenantId: string,
  experimentId: string,
): Promise<ResultadoDeExperimento | null> {
  const experimento = await prisma.experiment.findFirst({
    where: { id: experimentId, tenantId },
    include: { dish: { select: { name: true, description: true, priceCents: true } } },
  });
  if (!experimento) return null;

  // Embudo: de la analitica, partido por la variante que mando el cliente.
  const eventos = await prisma.analyticsEvent.groupBy({
    by: ['variant', 'type'],
    where: {
      tenantId,
      dishId: experimento.dishId,
      variant: { not: null },
      createdAt: { gte: experimento.startedAt },
    },
    _count: { _all: true },
  });

  // Pedidos e ingreso: de las lineas de pedido, que guardan con que variante se
  // COBRO. No se deduce del guestId del pedido: el borrado de datos del
  // comensal lo pone en null, y ahi el pedido quedaria sin atribuir.
  const lineas = await prisma.orderItem.groupBy({
    by: ['variant'],
    where: {
      dishId: experimento.dishId,
      variant: { not: null },
      order: {
        tenantId,
        createdAt: { gte: experimento.startedAt },
        // Solo lo que se pago: un pedido sin pagar no es una conversion.
        status: { in: ['PAID', 'IN_KITCHEN', 'READY', 'SERVED'] },
      },
    },
    _count: { _all: true },
    _sum: { quantity: true },
  });

  // El ingreso necesita precio x cantidad, que `groupBy` no sabe multiplicar.
  const paraIngreso = await prisma.orderItem.findMany({
    where: {
      dishId: experimento.dishId,
      variant: { not: null },
      order: {
        tenantId,
        createdAt: { gte: experimento.startedAt },
        status: { in: ['PAID', 'IN_KITCHEN', 'READY', 'SERVED'] },
      },
    },
    select: { variant: true, unitPriceCents: true, quantity: true },
  });

  const contar = (variant: Variant, type: string): number =>
    eventos.find((e) => e.variant === variant && e.type === type)?._count._all ?? 0;

  const numeros = (variant: Variant, valor: string): NumerosDeVariante => {
    const vistas = contar(variant, 'DISH_OPEN');
    const alCarrito = contar(variant, 'ADD_TO_CART');
    const pedidos = lineas.find((l) => l.variant === variant)?._count._all ?? 0;
    const ingresoCents = paraIngreso
      .filter((l) => l.variant === variant)
      .reduce((acc, l) => acc + l.unitPriceCents * l.quantity, 0);

    return {
      variant,
      valor,
      vistas,
      alCarrito,
      pedidos,
      ingresoCents,
      conversion: vistas > 0 ? pedidos / vistas : null,
      ingresoPorVistaCents: vistas > 0 ? Math.round(ingresoCents / vistas) : null,
    };
  };

  const esPrecio = experimento.field === ExperimentField.PRICE;
  const valorA = esPrecio
    ? String(experimento.dish.priceCents)
    : (experimento.dish.description ?? '(sin descripcion)');

  const a = numeros(Variant.A, valorA);
  const b = numeros(Variant.B, experimento.valueB);

  return {
    id: experimento.id,
    dishId: experimento.dishId,
    dishName: experimento.dish.name,
    field: experimento.field,
    status: experimento.status,
    startedAt: experimento.startedAt.toISOString(),
    stoppedAt: experimento.stoppedAt?.toISOString() ?? null,
    winner: experimento.winner,
    variantes: [a, b],
    veredicto: veredictoDe(a, b),
    avisoDePrecio: esPrecio,
  };
}
