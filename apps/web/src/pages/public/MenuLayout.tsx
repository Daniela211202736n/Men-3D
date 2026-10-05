/**
 * Marco de la carta: resuelve el restaurante del slug, monta el carrito y pinta
 * la cabecera con el pie fijo del pedido.
 */
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useParams, useSearchParams } from 'react-router-dom';

import { ConsentBanner } from '../../components/ConsentBanner.js';

import { AnalyticsEvent, setAnalyticsSlug, track, trackOnce } from '../../lib/analytics.js';
import { publicApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { LOCALE_NAMES } from '../../lib/i18n.js';
import { getTable, setTable } from '../../lib/session.js';
import { CartProvider, useCart } from '../../store/cart.js';
import { VenueProvider, useVenue } from '../../store/venue.js';
import { ErrorState, Spinner } from '../../components/ui.js';

export function MenuLayout(): ReactNode {
  const { slug = '' } = useParams();

  return (
    <VenueProvider slug={slug}>
      <CartProvider slug={slug}>
        <MenuShell />
      </CartProvider>
    </VenueProvider>
  );
}

function MenuShell(): ReactNode {
  const { venue, loading, error, reload, slug, locale, setLocale, theme, setTheme, t } =
    useVenue();
  const [params] = useSearchParams();

  // Primer evento de la visita y registro del escaneo del QR de la mesa.
  useEffect(() => {
    if (!venue) return;
    setAnalyticsSlug(slug);
    trackOnce(AnalyticsEvent.MENU_OPEN, slug, { locale });

    const qrToken = params.get('t');
    const table = params.get('mesa');
    if (table) setTable(table);
    if (qrToken) {
      void publicApi.registerScan(slug, qrToken).catch(() => undefined);
    }
  }, [venue, slug, locale, params]);

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error || !venue) {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <ErrorState
          message={
            error?.message ??
            'No encontramos este restaurante. Revisa el enlace o volve a escanear el QR.'
          }
          onRetry={reload}
          retryLabel={t('common.retry')}
        />
      </div>
    );
  }

  const table = getTable();

  return (
    <div className="app">
      <header className="sticky-top">
        <div className="container row-between" style={{ padding: '10px 16px' }}>
          <div className="row grow" style={{ minWidth: 0 }}>
            {venue.branding.logoUrl && (
              <img className="venue-logo" src={venue.branding.logoUrl} alt="" width={52} height={52} />
            )}
            <div className="stack grow" style={{ gap: 1, minWidth: 0 }}>
              <strong className="venue-name truncate">{venue.name}</strong>
              <span className="tiny muted">
                {table ? `${t('cart.table')} ${table}` : venue.city}
              </span>
            </div>
          </div>

          <div className="row" style={{ gap: 4 }}>
            {venue.enabledLocales.length > 1 && (
              <>
                <label className="sr-only" htmlFor="locale-select">
                  {t('lang.label')}
                </label>
                <select
                  id="locale-select"
                  className="select"
                  style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: '0.8rem' }}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as typeof locale)}
                >
                  {venue.enabledLocales.map((code) => (
                    <option key={code} value={code}>
                      {LOCALE_NAMES[code]}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-label={t('theme.toggle')}
              title={t('theme.toggle')}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>

        <nav className="container row" style={{ gap: 6, padding: '0 16px 8px' }}>
          <TabLink to={`/m/${slug}`} end>
            {t('nav.menu')}
          </TabLink>
          <TabLink to={`/m/${slug}/local`}>{t('nav.venue')}</TabLink>
        </nav>
      </header>

      <main className="grow" style={{ paddingBottom: 12 }}>
        <Outlet />
      </main>

      {/* Discreto pero siempre alcanzable: quien quiere ver o borrar sus datos
          no deberia tener que buscar el enlace. */}
      <footer className="center" style={{ padding: '4px 16px 16px' }}>
        <Link to={`/m/${slug}/privacidad`} className="tiny muted">
          {t('privacy.link')}
        </Link>
      </footer>

      <ConsentBanner slug={slug} />
      <CartBar />
    </div>
  );
}

function TabLink({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `chip${isActive ? ' is-active' : ''}`}
    >
      {children}
    </NavLink>
  );
}

/** Pie fijo con el total; aparece solo cuando hay algo en el pedido. */
function CartBar(): ReactNode {
  const { itemCount, subtotalCents } = useCart();
  const { venue, slug, locale, t } = useVenue();

  if (itemCount === 0 || !venue) return null;
  if (!venue.features.includes('ONLINE_ORDERING')) return null;

  return (
    <div className="sticky-bottom">
      <NavLink
        to={`/m/${slug}/pedido`}
        className="btn btn-primary btn-block"
        onClick={() => track(AnalyticsEvent.CHECKOUT_START)}
      >
        {t('nav.cart')} · {itemCount} · {money(subtotalCents, venue.currency, locale)}
      </NavLink>
    </div>
  );
}
