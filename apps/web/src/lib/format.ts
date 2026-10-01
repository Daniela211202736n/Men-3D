import { formatMoney } from '@men3d/shared';

/** Mapa de locale de la app -> locale de Intl. */
const INTL_LOCALE: Record<string, string> = {
  es: 'es-AR',
  en: 'en-US',
  pt: 'pt-BR',
  fr: 'fr-FR',
  it: 'it-IT',
  de: 'de-DE',
};

export function money(cents: number, currency: string, locale = 'es'): string {
  return formatMoney(cents, currency, INTL_LOCALE[locale] ?? 'es-AR');
}

/** Numeros grandes compactos para los indicadores del panel: 12,9 mil. */
export function compactNumber(value: number, locale = 'es'): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale] ?? 'es-AR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function integer(value: number, locale = 'es'): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale] ?? 'es-AR').format(value);
}

export function percent(value: number, locale = 'es'): string {
  return `${new Intl.NumberFormat(INTL_LOCALE[locale] ?? 'es-AR', {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export function shortDate(iso: string, locale = 'es'): string {
  return new Date(iso).toLocaleDateString(INTL_LOCALE[locale] ?? 'es-AR', {
    day: '2-digit',
    month: 'short',
  });
}

export function relativeTime(iso: string, locale = 'es'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale] ?? 'es-AR', {
    numeric: 'auto',
  });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

/**
 * Minutos transcurridos desde una fecha: lo que mira la cocina en el KDS.
 *
 * Nunca devuelve negativo. Un reloj de servidor adelantado respecto del
 * dispositivo haria aparecer "-7 min" en un ticket, que no significa nada para
 * quien esta cocinando.
 */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
