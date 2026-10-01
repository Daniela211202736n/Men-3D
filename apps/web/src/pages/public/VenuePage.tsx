/**
 * Ficha del local: ubicacion, contacto, redes, horarios y opiniones generales.
 */
import type { ReactNode } from 'react';

import { RatingBreakdown, ReviewForm, ReviewList } from '../../components/Reviews.js';
import { Spinner, Stars } from '../../components/ui.js';
import { AnalyticsEvent, track } from '../../lib/analytics.js';
import { publicApi } from '../../lib/api.js';
import { useAsync } from '../../lib/useAsync.js';
import { useVenue } from '../../store/venue.js';

export function VenuePage(): ReactNode {
  const { slug, venue, locale, t, reload: reloadVenue } = useVenue();

  const { data: reviews, reload } = useAsync(
    (signal) => publicApi.reviews(slug, undefined, signal),
    [slug],
  );

  if (!venue) return <Spinner />;

  const mapsUrl = venue.googlePlaceId
    ? `https://www.google.com/maps/place/?q=place_id:${venue.googlePlaceId}`
    : venue.latitude !== null && venue.longitude !== null
      ? `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
      : venue.addressLine
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${venue.addressLine} ${venue.city ?? ''}`,
          )}`
        : null;

  const share = async () => {
    const url = window.location.origin + `/m/${slug}`;
    const text = `Mira la carta de ${venue.name} en 3D: ${url}`;
    track(AnalyticsEvent.SHARE);
    // `navigator.share` abre la hoja nativa del celular; en escritorio no
    // existe, asi que se cae a copiar el enlace.
    if (navigator.share) {
      try {
        await navigator.share({ title: venue.name, text, url });
        return;
      } catch {
        /* el usuario cancelo */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* sin permiso de portapapeles */
    }
  };

  return (
    <div className="container stack stack-5" style={{ paddingTop: 16 }}>
      <header className="stack stack-3">
        <h1>{venue.name}</h1>
        {venue.description && <p className="secondary">{venue.description}</p>}
        {venue.rating.count > 0 && (
          <div className="row" style={{ gap: 8 }}>
            <Stars value={venue.rating.average} />
            <span className="small nums secondary">
              {venue.rating.average} · {venue.rating.count} opiniones
            </span>
          </div>
        )}
      </header>

      <section className="card card-pad stack stack-3">
        {venue.addressLine && (
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">{t('venue.address')}</span>
            <span className="small secondary">
              {venue.addressLine}
              {venue.city ? `, ${venue.city}` : ''}
            </span>
          </div>
        )}
        {venue.openingHours && (
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">{t('venue.hours')}</span>
            <span className="small secondary">{venue.openingHours}</span>
          </div>
        )}

        {/* Mapa estatico embebido: un iframe de Google Maps no requiere clave y
            no carga el SDK completo en el celular del comensal. */}
        {venue.latitude !== null && venue.longitude !== null && (
          <iframe
            title={`Mapa de ${venue.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              width: '100%',
              height: 180,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${
              venue.longitude - 0.004
            },${venue.latitude - 0.002},${venue.longitude + 0.004},${
              venue.latitude + 0.002
            }&marker=${venue.latitude},${venue.longitude}`}
          />
        )}

        <div className="row wrap" style={{ gap: 8 }}>
          {mapsUrl && (
            <a className="btn btn-sm" href={mapsUrl} target="_blank" rel="noreferrer noopener">
              📍 {t('venue.map')}
            </a>
          )}
          {venue.phone && (
            <a className="btn btn-sm" href={`tel:${venue.phone}`}>
              {t('venue.call')}
            </a>
          )}
          {venue.whatsapp && (
            <a
              className="btn btn-sm"
              href={`https://wa.me/${venue.whatsapp.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              WhatsApp
            </a>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void share()}>
            {t('venue.share')}
          </button>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          {venue.instagramUrl && (
            <a className="chip" href={venue.instagramUrl} target="_blank" rel="noreferrer noopener">
              Instagram
            </a>
          )}
          {venue.tiktokUrl && (
            <a className="chip" href={venue.tiktokUrl} target="_blank" rel="noreferrer noopener">
              TikTok
            </a>
          )}
          {venue.facebookUrl && (
            <a className="chip" href={venue.facebookUrl} target="_blank" rel="noreferrer noopener">
              Facebook
            </a>
          )}
        </div>
      </section>

      <section className="stack stack-4">
        <h2>{t('venue.reviews')}</h2>
        {venue.rating.count > 0 && (
          <RatingBreakdown
            histogram={venue.rating.histogram}
            count={venue.rating.count}
          />
        )}
        <ReviewList reviews={reviews ?? []} locale={locale} t={t} />
        <ReviewForm
          t={t}
          onSubmit={async ({ rating, comment, authorName }) => {
            await publicApi.createReview(slug, {
              dishId: null,
              rating,
              comment: comment || undefined,
              authorName: authorName || undefined,
            });
            track(AnalyticsEvent.REVIEW_SUBMIT, { value: rating });
            reload();
            // El promedio del local cambia: se recarga la ficha para que el
            // encabezado no quede con el numero viejo.
            reloadVenue();
          }}
        />
      </section>
    </div>
  );
}
