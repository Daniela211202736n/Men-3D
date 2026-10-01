/** Moderacion de opiniones: publicar, ocultar y responder. */
import { useState, type ReactNode } from 'react';

import type { ReviewDto } from '@men3d/shared';

import { Stars } from '../../components/ui.js';
import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useToast } from '../../store/toast.js';

const FILTERS = [
  { value: undefined, label: 'Todas' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'PUBLISHED', label: 'Publicadas' },
  { value: 'HIDDEN', label: 'Ocultas' },
] as const;

export function ReviewsPage(): ReactNode {
  const toast = useToast();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const { data: reviews, loading, error, reload, setData } = useAsync(
    (signal) => adminApi.adminReviews(status, signal),
    [status],
  );

  const moderate = async (
    review: ReviewDto,
    next: 'PUBLISHED' | 'HIDDEN',
    reply?: string | null,
  ) => {
    try {
      const updated = await adminApi.moderateReview(review.id, { status: next, reply });
      setData((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
      toast.show(next === 'PUBLISHED' ? 'Opinion publicada' : 'Opinion oculta');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo guardar', 'error');
      reload();
    }
  };

  if (loading && !reviews) return <Spinner label="Cargando opiniones" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  return (
    <div className="stack stack-5">
      <header className="stack stack-3">
        <h1>Opiniones</h1>
        <div className="row wrap" style={{ gap: 6 }}>
          {FILTERS.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className="chip"
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {reviews?.length === 0 && <p className="muted">No hay opiniones con ese filtro.</p>}

      <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {reviews?.map((review) => (
          <ReviewRow key={review.id} review={review} onModerate={moderate} />
        ))}
      </ul>
    </div>
  );
}

function ReviewRow({
  review,
  onModerate,
}: {
  review: ReviewDto;
  onModerate: (
    review: ReviewDto,
    status: 'PUBLISHED' | 'HIDDEN',
    reply?: string | null,
  ) => Promise<void>;
}): ReactNode {
  const [reply, setReply] = useState(review.reply ?? '');
  const [replying, setReplying] = useState(false);

  const statusBadge =
    review.status === 'PUBLISHED'
      ? 'badge-good'
      : review.status === 'HIDDEN'
        ? 'badge-critical'
        : 'badge-warning';

  return (
    <li className="card card-pad stack stack-3">
      <div className="row-between wrap">
        <div className="row" style={{ gap: 8 }}>
          <Stars value={review.rating} size={13} />
          <span className="small bold">{review.authorName}</span>
          {review.dishName && <span className="badge">{review.dishName}</span>}
          <span className={`badge ${statusBadge}`}>{review.status}</span>
        </div>
        <span className="tiny muted">{relativeTime(review.createdAt)}</span>
      </div>

      {review.comment && <p className="small secondary">{review.comment}</p>}

      {review.reply && !replying && (
        <div
          className="small"
          style={{
            background: 'var(--surface-2)',
            borderLeft: '3px solid var(--brand)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
          }}
        >
          <span className="tiny bold secondary">Tu respuesta</span>
          <p className="secondary">{review.reply}</p>
        </div>
      )}

      {replying && (
        <div className="stack stack-2">
          <textarea
            className="textarea"
            value={reply}
            maxLength={1000}
            placeholder="Responder publicamente..."
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                await onModerate(review, 'PUBLISHED', reply || null);
                setReplying(false);
              }}
            >
              Guardar respuesta
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setReplying(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!replying && (
        <div className="row wrap" style={{ gap: 8 }}>
          {review.status !== 'PUBLISHED' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void onModerate(review, 'PUBLISHED')}
            >
              Publicar
            </button>
          )}
          {review.status !== 'HIDDEN' && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => void onModerate(review, 'HIDDEN')}
            >
              Ocultar
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplying(true)}>
            {review.reply ? 'Editar respuesta' : 'Responder'}
          </button>
        </div>
      )}
    </li>
  );
}
