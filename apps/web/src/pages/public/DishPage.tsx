/**
 * Ficha del plato: el visor 3D/RA, la informacion que decide la compra
 * (porcion, alergenos, ingredientes), los maridajes y las opiniones.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { DishDto } from '@men3d/shared';

import { DishViewer3D } from '../../components/DishViewer3D.js';
import { ReviewForm, ReviewList } from '../../components/Reviews.js';
import { Badge3D, EmptyState, ErrorState, Spinner, Stars } from '../../components/ui.js';
import { AnalyticsEvent, track, trackOnce } from '../../lib/analytics.js';
import { publicApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { allergenLabel, dietLabel } from '../../lib/i18n.js';
import { useAsync } from '../../lib/useAsync.js';
import { useCart } from '../../store/cart.js';
import { useToast } from '../../store/toast.js';
import { useVenue } from '../../store/venue.js';

export function DishPage(): ReactNode {
  const { dishId = '' } = useParams();
  const { slug, venue, locale, t } = useVenue();
  const navigate = useNavigate();
  const cart = useCart();
  const toast = useToast();

  const { data: dish, loading, error, reload } = useAsync(
    (signal) => publicApi.dish(slug, dishId, locale, signal),
    [slug, dishId, locale],
  );

  const { data: pairings } = useAsync(
    (signal) => publicApi.pairings(slug, dishId, locale, signal),
    [slug, dishId, locale],
  );

  const { data: reviews, reload: reloadReviews } = useAsync(
    (signal) => publicApi.reviews(slug, dishId, signal),
    [slug, dishId],
  );

  useEffect(() => {
    if (dish) trackOnce(AnalyticsEvent.DISH_OPEN, dish.id, { dishId: dish.id, locale });
  }, [dish, locale]);

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error || !dish) {
    return (
      <div className="container" style={{ paddingTop: 24 }}>
        <ErrorState message={error?.message ?? t('common.error')} onRetry={reload} />
      </div>
    );
  }

  const canOrder = venue?.features.includes('ONLINE_ORDERING') ?? false;

  const addToCart = () => {
    cart.add(dish, 1);
    track(AnalyticsEvent.ADD_TO_CART, { dishId: dish.id, value: 1 });
    toast.show(t('dish.added'));
  };

  return (
    <div className="container stack stack-5" style={{ paddingTop: 12 }}>
      <Link to={`/m/${slug}`} className="small secondary">
        ← {t('common.back')}
      </Link>

      {dish.modelGlbUrl ? (
        <DishViewer3D
          dishId={dish.id}
          dishName={dish.name}
          glbUrl={dish.modelGlbUrl}
          usdzUrl={dish.modelUsdzUrl}
          posterUrl={dish.imageUrl}
          portionLabel={
            dish.portionGrams ? t('dish.portion', { grams: dish.portionGrams }) : null
          }
          rotateHint={t('dish.rotateHint')}
          arLabel={t('dish.viewAr')}
          arHint={t('dish.arHint')}
        />
      ) : dish.imageUrl ? (
        <img
          src={dish.imageUrl}
          alt={dish.name}
          className="viewer-wrap"
          style={{ width: '100%', objectFit: 'cover', maxHeight: 320 }}
        />
      ) : null}

      <header className="stack stack-3">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="stack stack-2 grow">
            <h1>{dish.name}</h1>
            <div className="row wrap" style={{ gap: 6 }}>
              {dish.has3d && <Badge3D />}
              {dish.dietTags.map((tag) => (
                <span key={tag} className="badge">
                  {dietLabel(tag, locale)}
                </span>
              ))}
              {dish.translated && (
                <span className="badge" title={t('dish.translated')}>
                  🌐 {t('dish.translated')}
                </span>
              )}
            </div>
          </div>
          <div className="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 700 }}>
              {money(dish.priceCents, dish.currency, locale)}
            </span>
            {dish.compareAtPriceCents && dish.compareAtPriceCents > dish.priceCents && (
              <span className="dish-price-old">
                {money(dish.compareAtPriceCents, dish.currency, locale)}
              </span>
            )}
          </div>
        </div>

        {dish.rating.count > 0 && (
          <div className="row" style={{ gap: 7 }}>
            <Stars value={dish.rating.average} size={14} />
            <span className="small nums secondary">
              {dish.rating.average} · {dish.rating.count}
            </span>
          </div>
        )}

        {dish.description && <p className="secondary">{dish.description}</p>}

        {/* Datos duros: lo que el comensal quiere saber antes de pedir. */}
        <div className="row wrap small muted" style={{ gap: 12 }}>
          {dish.portionGrams && <span>{t('dish.portion', { grams: dish.portionGrams })}</span>}
          {dish.calories && <span>{t('dish.calories', { kcal: dish.calories })}</span>}
          {dish.prepMinutes && <span>{t('dish.prep', { min: dish.prepMinutes })}</span>}
        </div>
      </header>

      {dish.ingredients.length > 0 && (
        <section className="stack stack-2">
          <h3>{t('dish.ingredients')}</h3>
          <p className="small secondary">{dish.ingredients.join(' · ')}</p>
        </section>
      )}

      <section className="stack stack-2">
        <h3>{t('dish.allergens')}</h3>
        {dish.allergens.length === 0 ? (
          <p className="small muted">{t('dish.allergensNone')}</p>
        ) : (
          <div className="row wrap" style={{ gap: 6 }}>
            {dish.allergens.map((allergen) => (
              <span key={allergen} className="badge badge-warning">
                {allergenLabel(allergen, locale)}
              </span>
            ))}
          </div>
        )}
      </section>

      {pairings && pairings.length > 0 && (
        <section className="stack stack-3">
          <h3>{t('dish.pairings')}</h3>
          <div className="stack stack-2">
            {pairings.map((pairing) => (
              <button
                key={pairing.dish.id}
                type="button"
                className="card card-pad row-between"
                style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                onClick={() => navigate(`/m/${slug}/plato/${pairing.dish.id}`)}
              >
                <span className="stack" style={{ gap: 2 }}>
                  <span className="bold small">{pairing.dish.name}</span>
                  {pairing.blurb && <span className="tiny muted">{pairing.blurb}</span>}
                </span>
                <span className="small nums bold">
                  {money(pairing.dish.priceCents, pairing.dish.currency, locale)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="stack stack-3">
        <h3>{t('dish.reviews')}</h3>
        <ReviewList reviews={reviews ?? []} locale={locale} t={t} />
        <ReviewForm
          t={t}
          onSubmit={async ({ rating, comment, authorName }) => {
            await publicApi.createReview(slug, {
              dishId: dish.id,
              rating,
              comment: comment || undefined,
              authorName: authorName || undefined,
            });
            track(AnalyticsEvent.REVIEW_SUBMIT, { dishId: dish.id, value: rating });
            reloadReviews();
          }}
        />
      </section>

      {canOrder && (
        <div className="sticky-bottom">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={addToCart}
            disabled={!dish.isAvailable}
          >
            {dish.isAvailable ? t('dish.add') : t('dish.unavailable')}
          </button>
        </div>
      )}

      {!canOrder && !dish.isAvailable && (
        <EmptyState title={t('dish.unavailable')} />
      )}
    </div>
  );
}
