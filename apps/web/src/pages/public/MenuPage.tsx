/**
 * La carta. Busqueda incremental, filtros y lista por categoria.
 *
 * La busqueda se debouncea 260 ms: escribir "milanesa" son ocho pulsaciones y no
 * tiene sentido pegarle ocho veces al servidor desde un celular.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import type { DishDto } from '@men3d/shared';

import { DishCard } from '../../components/DishCard.js';
import {
  EMPTY_FILTERS,
  FilterSheet,
  countActiveFilters,
  type FilterValue,
} from '../../components/FilterSheet.js';
import { EmptyState, ErrorState, SearchIcon, Spinner, Stars } from '../../components/ui.js';
import { setVariantesServidas } from '../../lib/analytics.js';
import { publicApi } from '../../lib/api.js';
import { getGuestId } from '../../lib/session.js';
import { useAsync, useDebounced } from '../../lib/useAsync.js';
import { useVenue } from '../../store/venue.js';

export function MenuPage(): ReactNode {
  const { slug, venue, locale, t } = useVenue();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterValue>(EMPTY_FILTERS);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const debouncedQuery = useDebounced(query, 260);

  const { data, loading, error, reload } = useAsync(
    (signal) =>
      publicApi.menu(
        slug,
        {
          q: debouncedQuery || undefined,
          categoryId: activeCategory ?? undefined,
          diets: filters.diets,
          excludeAllergens: filters.excludeAllergens,
          only3d: filters.only3d || undefined,
          locale,
          // Para que el servidor resuelva las pruebas A/B con el MISMO
          // identificador con el que va a liquidar el pedido. Si esto no
          // viajara, la carta mostraria el precio de control y el pedido se
          // cobraria con la variante: el comensal pagaria algo que no vio.
          guestId: getGuestId(),
        },
        signal,
      ),
    [slug, debouncedQuery, activeCategory, filters, locale],
  );

  // La carta dice que variante le toco a cada plato; de ahi en adelante los
  // eventos de analitica la llevan solos.
  useEffect(() => {
    setVariantesServidas(data?.experiments ?? {});
  }, [data]);

  const grouped = useMemo(() => {
    if (!data) return [];
    // Se respeta el orden de categorias que definio el restaurante y, dentro,
    // el orden de los platos que ya trae el backend (destacados primero).
    return data.categories
      .map((category) => ({
        category,
        dishes: data.dishes.filter((dish) => dish.categoryId === category.id),
      }))
      .filter((group) => group.dishes.length > 0);
  }, [data]);

  const openDish = (dish: DishDto) => navigate(`/m/${slug}/plato/${dish.id}`);
  const activeFilterCount = countActiveFilters(filters);

  return (
    <>
      <section className="menu-hero">
        <div className="container stack stack-3">
          {venue?.branding.heroImageUrl && (
            <img
              className="menu-hero-img"
              src={venue.branding.heroImageUrl}
              alt=""
              loading="eager"
            />
          )}
          {venue?.description && <p className="small secondary">{venue.description}</p>}
          {venue && venue.rating.count > 0 && (
            <div className="row" style={{ gap: 7 }}>
              <Stars value={venue.rating.average} size={14} />
              <span className="small nums secondary">
                {venue.rating.average} · {venue.rating.count} opiniones
              </span>
            </div>
          )}

          <div className="search-bar">
            <span className="search-icon">
              <SearchIcon />
            </span>
            <input
              className="input"
              type="search"
              value={query}
              placeholder={t('search.placeholder')}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('search.placeholder')}
              enterKeyHint="search"
            />
            {query && (
              <button
                type="button"
                className="btn btn-ghost btn-sm search-clear"
                onClick={() => setQuery('')}
              >
                {t('search.clear')}
              </button>
            )}
          </div>

          <div className="filter-scroll">
            <button
              type="button"
              className="chip"
              aria-pressed={activeFilterCount > 0}
              onClick={() => setSheetOpen(true)}
            >
              ⚙ {t('filters.open')}
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            >
              Todo
            </button>
            {data?.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="chip"
                aria-pressed={activeCategory === category.id}
                onClick={() =>
                  setActiveCategory(activeCategory === category.id ? null : category.id)
                }
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container stack stack-5" style={{ paddingTop: 16 }}>
        {loading && !data && <Spinner label={t('common.loading')} />}

        {error && (
          <ErrorState
            message={error.message}
            onRetry={reload}
            retryLabel={t('common.retry')}
          />
        )}

        {data && data.dishes.length === 0 && (
          <EmptyState
            title={t('search.empty.title')}
            body={t('search.empty.body')}
            action={
              (query || activeFilterCount > 0) && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setQuery('');
                    setFilters(EMPTY_FILTERS);
                    setActiveCategory(null);
                  }}
                >
                  {t('filters.clear')}
                </button>
              )
            }
          />
        )}

        {data && data.dishes.length > 0 && (
          <>
            {(query || activeFilterCount > 0) && (
              <p className="small muted" aria-live="polite">
                {t('search.results', { n: data.matchCount })}
              </p>
            )}

            {grouped.map(({ category, dishes }) => (
              <section key={category.id} className="stack stack-3">
                <h2>{category.name}</h2>
                {category.description && (
                  <p className="small muted">{category.description}</p>
                )}
                <div className="dish-list">
                  {dishes.map((dish) => (
                    <DishCard
                      key={dish.id}
                      dish={dish}
                      locale={locale}
                      t={t}
                      onOpen={openDish}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {sheetOpen && (
        <FilterSheet
          value={filters}
          onChange={setFilters}
          onClose={() => setSheetOpen(false)}
          resultCount={data?.matchCount ?? 0}
          locale={locale}
          t={t}
        />
      )}
    </>
  );
}
