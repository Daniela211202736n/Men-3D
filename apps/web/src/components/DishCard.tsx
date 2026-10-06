/** Fila de la carta. Es un boton entero: en un celular todo el bloque es tocable. */
import type { DishDto, Locale } from '@men3d/shared';
import type { ReactNode } from 'react';

import { dietLabel, type Translate } from '../lib/i18n.js';
import { money } from '../lib/format.js';
import { Badge3D, Miniatura, Stars } from './ui.js';

export function DishCard({
  dish,
  locale,
  t,
  onOpen,
}: {
  dish: DishDto;
  locale: Locale;
  t: Translate;
  onOpen: (dish: DishDto) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={`dish-card${dish.isAvailable ? '' : ' is-unavailable'}`}
      onClick={() => onOpen(dish)}
      aria-label={`${dish.name}, ${money(dish.priceCents, dish.currency, locale)}`}
    >
      <Miniatura src={dish.imageUrl} has3d={dish.has3d} size={112} />

      <span className="stack stack-2 grow">
        <span className="dish-name">{dish.name}</span>

        {dish.description && (
          <span
            className="small secondary"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {dish.description}
          </span>
        )}

        <span className="row wrap" style={{ gap: 8 }}>
          <span className="dish-price">
            {money(dish.priceCents, dish.currency, locale)}
          </span>
          {dish.compareAtPriceCents && dish.compareAtPriceCents > dish.priceCents && (
            <span className="dish-price-old">
              {money(dish.compareAtPriceCents, dish.currency, locale)}
            </span>
          )}
          {dish.has3d && <Badge3D />}
          {!dish.isAvailable && (
            <span className="badge badge-warning">{t('dish.unavailable')}</span>
          )}
          {dish.rating.count > 0 && (
            <span className="row" style={{ gap: 4 }}>
              <Stars value={dish.rating.average} size={12} />
              <span className="tiny muted nums">
                {dish.rating.average} ({dish.rating.count})
              </span>
            </span>
          )}
          {dish.dietTags.slice(0, 1).map((tag) => (
            <span key={tag} className="badge badge-quiet">
              {dietLabel(tag, locale)}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}
