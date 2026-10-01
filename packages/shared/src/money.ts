/**
 * Helpers de dinero. Todo se guarda y se transporta en centavos (enteros); el
 * formateo a texto ocurre solo en el borde de presentacion.
 */

export function formatMoney(
  cents: number,
  currency: string,
  locale = 'es-AR',
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Moneda no reconocida por Intl: degradar sin romper la vista.
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** Aplica una tasa en basis points (1 bp = 0,01 %) redondeando al centavo. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Fuente unica de verdad del calculo de un pedido: la usa la API al cobrar y la
 * PWA para previsualizar el total, de modo que nunca difieran.
 */
export function computeOrderTotals(
  lines: Array<{ unitPriceCents: number; quantity: number }>,
  opts: { taxRateBps?: number; discountCents?: number } = {},
): OrderTotals {
  const subtotalCents = lines.reduce(
    (acc, l) => acc + l.unitPriceCents * l.quantity,
    0,
  );
  // El descuento nunca puede exceder el subtotal.
  const discountCents = Math.min(
    Math.max(opts.discountCents ?? 0, 0),
    subtotalCents,
  );
  const taxCents = applyBps(subtotalCents - discountCents, opts.taxRateBps ?? 0);
  return {
    subtotalCents,
    taxCents,
    discountCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}
