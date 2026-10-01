/**
 * Aplica la identidad visual del restaurante sobre los tokens de CSS.
 *
 * El branding cambia variables (`--brand`, `--accent`, ...), nunca reglas. Por
 * eso un restaurante puede cambiar su color sin que nada del layout se mueva, y
 * por eso la personalizacion no puede romper el contraste del texto: el color
 * de marca solo pinta fondos de acento, y el ink que va encima se calcula.
 */
import type { BrandingDto } from '@men3d/shared';

/** Luminancia relativa (WCAG 2.1) de un color hex. */
function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized;
  const channels = [0, 2, 4].map((i) => {
    const value = parseInt(full.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Elige blanco o negro para el texto que va *encima* del color de marca, segun
 * cual de los dos contrasta mas. Sin esto, un restaurante con marca amarilla
 * tendria botones con texto blanco ilegible.
 */
export function inkFor(hex: string): string {
  try {
    const luminance = relativeLuminance(hex);
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#0b0b0b';
  } catch {
    return '#ffffff';
  }
}

export function applyBranding(branding: BrandingDto | null | undefined): void {
  const root = document.documentElement;
  if (!branding) return;

  root.style.setProperty('--brand', branding.primaryColor);
  root.style.setProperty('--brand-ink', inkFor(branding.primaryColor));
  root.style.setProperty('--accent', branding.accentColor);
  if (branding.fontFamily) root.style.setProperty('--font', branding.fontFamily);

  if (branding.backgroundImageUrl) {
    document.body.style.backgroundImage = `url(${CSS.escape(branding.backgroundImageUrl)})`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
  } else {
    document.body.style.backgroundImage = '';
  }

  // La barra del navegador en el celular toma el color de marca.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', branding.primaryColor);

  if (branding.faviconUrl) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = branding.faviconUrl;
  }
}

const THEME_KEY = 'men3d.theme';
export type ThemeChoice = 'light' | 'dark' | 'system';

/**
 * Preferencia de tema. `system` borra el atributo para que manden las media
 * queries; 'light'/'dark' lo fuerzan (y en styles.css el selector manual le
 * gana al sistema operativo en los dos sentidos).
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* sin persistencia */
  }
}

export function readTheme(fallback: ThemeChoice = 'system'): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* sin acceso al storage */
  }
  return fallback;
}
