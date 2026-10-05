/** Fila de la carta. Es un boton entero: en un celular todo el bloque es tocable. */
import type { DishDto, Locale } from '@men3d/shared';
import { useState, type ReactNode } from 'react';

import { dietLabel, type Translate } from '../lib/i18n.js';
import { money } from '../lib/format.js';
import { Badge3D, Stars } from './ui.js';

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
  const [fotoRota, setFotoRota] = useState(false);

  return (
    <button
      type="button"
      className={`dish-card${dish.isAvailable ? '' : ' is-unavailable'}`}
      onClick={() => onOpen(dish)}
      aria-label={`${dish.name}, ${money(dish.priceCents, dish.currency, locale)}`}
    >
      <span className="dish-thumb">
        {dish.imageUrl && !fotoRota ? (
          <img
            src={dish.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={112}
            height={112}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            // Una foto que no carga —un CDN con hipo, una URL vieja— no puede
            // dejarle al comensal el icono de imagen rota del navegador.
            onError={() => setFotoRota(true)}
          />
        ) : (
          // Sin foto: el icono de cubo anticipa que hay modelo 3D.
          <PlateGlyph has3d={dish.has3d} />
        )}
      </span>

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

function PlateGlyph({ has3d }: { has3d: boolean }): ReactNode {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      style={{ color: 'var(--text-muted)' }}
    >
      <ellipse cx="24" cy="30" rx="16" ry="6" />
      <ellipse cx="24" cy="29" rx="10" ry="3.4" opacity="0.5" />
      {has3d && <path d="M24 10l8 4.5v9L24 28l-8-4.5v-9z" />}
    </svg>
  );
}
