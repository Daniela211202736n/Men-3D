/**
 * Contexto del restaurante abierto: sus datos, su marca y el idioma elegido.
 *
 * Carga el local una sola vez por slug y aplica el branding al montar, de modo
 * que todas las pantallas de la carta ya nacen con los colores del lugar.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_LOCALE, type Locale, type VenueDto } from '@men3d/shared';

import { publicApi } from '../lib/api.js';
import { applyBranding, applyTheme, readTheme, type ThemeChoice } from '../lib/branding.js';
import { createTranslate, detectLocale, type Translate } from '../lib/i18n.js';
import { useAsync } from '../lib/useAsync.js';

const LOCALE_KEY = 'men3d.locale';

interface VenueContextValue {
  slug: string;
  venue: VenueDto | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
}

const VenueContext = createContext<VenueContextValue | null>(null);

export function VenueProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}): ReactNode {
  const { data: venue, loading, error, reload } = useAsync(
    (signal) => publicApi.venue(slug, signal),
    [slug],
  );

  const [localeOverride, setLocaleOverride] = useState<Locale | null>(() => {
    try {
      const stored = localStorage.getItem(LOCALE_KEY);
      return stored ? (stored as Locale) : null;
    } catch {
      return null;
    }
  });

  const [theme, setThemeState] = useState<ThemeChoice>(() => readTheme());

  // El idioma efectivo: el elegido a mano si el local lo ofrece; si no, el del
  // telefono; si tampoco, el idioma por defecto del restaurante.
  const locale = useMemo<Locale>(() => {
    const enabled = venue?.enabledLocales?.length
      ? venue.enabledLocales
      : [venue?.defaultLocale ?? DEFAULT_LOCALE];
    if (localeOverride && enabled.includes(localeOverride)) return localeOverride;
    return detectLocale(enabled);
  }, [venue, localeOverride]);

  useEffect(() => {
    if (venue) applyBranding(venue.branding);
  }, [venue]);

  // El tema del restaurante es el valor inicial; la eleccion del comensal manda.
  useEffect(() => {
    if (!venue) return;
    const stored = readTheme(venue.branding.colorScheme);
    setThemeState(stored);
    applyTheme(stored);
  }, [venue]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<VenueContextValue>(
    () => ({
      slug,
      venue,
      loading,
      error,
      reload,
      locale,
      setLocale: (next) => {
        setLocaleOverride(next);
        try {
          localStorage.setItem(LOCALE_KEY, next);
        } catch {
          /* sin persistencia */
        }
      },
      t: createTranslate(locale),
      theme,
      setTheme: (next) => {
        setThemeState(next);
        applyTheme(next);
      },
    }),
    [slug, venue, loading, error, reload, locale, theme],
  );

  return <VenueContext.Provider value={value}>{children}</VenueContext.Provider>;
}

export function useVenue(): VenueContextValue {
  const context = useContext(VenueContext);
  if (!context) throw new Error('useVenue debe usarse dentro de <VenueProvider>');
  return context;
}
