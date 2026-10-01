/** Listado de opiniones y formulario para dejar una. */
import type { ReviewDto } from '@men3d/shared';
import { useState, type ReactNode } from 'react';

import { relativeTime } from '../lib/format.js';
import type { Translate } from '../lib/i18n.js';
import { Stars, StarInput } from './ui.js';

export function ReviewList({
  reviews,
  locale,
  t,
}: {
  reviews: ReviewDto[];
  locale: string;
  t: Translate;
}): ReactNode {
  if (reviews.length === 0) {
    return <p className="small muted">{t('dish.noReviews')}</p>;
  }

  return (
    <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {reviews.map((review) => (
        <li key={review.id} className="stack stack-2">
          <div className="row-between">
            <div className="row" style={{ gap: 8 }}>
              <Stars value={review.rating} size={13} />
              <span className="small bold">{review.authorName}</span>
            </div>
            <span className="tiny muted">{relativeTime(review.createdAt, locale)}</span>
          </div>
          {review.comment && <p className="small secondary">{review.comment}</p>}
          {review.reply && (
            <div
              className="small"
              style={{
                background: 'var(--surface-2)',
                borderLeft: '3px solid var(--brand)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
              }}
            >
              <span className="tiny bold secondary">{t('review.reply')}</span>
              <p className="secondary">{review.reply}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ReviewForm({
  onSubmit,
  t,
}: {
  onSubmit: (input: { rating: number; comment: string; authorName: string }) => Promise<void>;
  t: Translate;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="small" style={{ color: 'var(--good)' }}>
        {t('review.thanks')}
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        {t('review.write')}
      </button>
    );
  }

  return (
    <form
      className="stack stack-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (rating === 0 || sending) return;
        setSending(true);
        try {
          await onSubmit({ rating, comment, authorName });
          setDone(true);
        } finally {
          setSending(false);
        }
      }}
    >
      <div className="field">
        <span className="label">{t('review.rating')}</span>
        <StarInput value={rating} onChange={setRating} label={t('review.rating')} />
      </div>
      <label className="field">
        <span className="label">{t('review.comment')}</span>
        <textarea
          className="textarea"
          value={comment}
          maxLength={1000}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">{t('review.name')}</span>
        <input
          className="input"
          value={authorName}
          maxLength={60}
          onChange={(e) => setAuthorName(e.target.value)}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary grow"
          disabled={rating === 0 || sending}
        >
          {sending ? t('common.loading') : t('review.send')}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          {t('common.close')}
        </button>
      </div>
    </form>
  );
}

/** Histograma de 1 a 5 estrellas para la ficha del local. */
export function RatingBreakdown({
  histogram,
  count,
}: {
  histogram: readonly number[];
  count: number;
}): ReactNode {
  return (
    <div className="stack stack-2">
      {[5, 4, 3, 2, 1].map((star) => {
        const value = histogram[star - 1] ?? 0;
        const share = count === 0 ? 0 : (value / count) * 100;
        return (
          <div key={star} className="row" style={{ gap: 8 }}>
            <span className="tiny nums muted" style={{ width: 12 }}>
              {star}
            </span>
            <span className="rating-bar-track">
              <span className="rating-bar-fill" style={{ width: `${share}%` }} />
            </span>
            <span className="tiny nums muted" style={{ width: 28, textAlign: 'right' }}>
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
