/**
 * Seguimiento del pedido.
 *
 * Refresca cada 15 segundos mientras el pedido esta vivo y deja de pedir
 * cuando llega a un estado final: una pantalla olvidada sobre la mesa no tiene
 * que seguir golpeando el servidor toda la tarde.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { OrderStatus } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { AnalyticsEvent, track } from '../../lib/analytics.js';
import { publicApi } from '../../lib/api.js';
import { money, relativeTime } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useVenue } from '../../store/venue.js';

const STEPS = [
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.IN_KITCHEN,
  OrderStatus.READY,
  OrderStatus.SERVED,
] as const;

const FINAL_STATES: string[] = [OrderStatus.SERVED, OrderStatus.CANCELED];

export function OrderStatusPage(): ReactNode {
  const { code = '' } = useParams();
  const { slug, venue, locale, t } = useVenue();

  const { data: order, loading, error, reload } = useAsync(
    (signal) => publicApi.order(slug, code, signal),
    [slug, code],
  );

  useEffect(() => {
    if (!order || FINAL_STATES.includes(order.status)) return;
    // Mientras se espera la acreditacion del pago se consulta mas seguido: el
    // comensal acaba de volver de la pasarela y esta mirando la pantalla.
    const everyMs = order.status === OrderStatus.PENDING_PAYMENT ? 5_000 : 15_000;
    const timer = setInterval(reload, everyMs);
    return () => clearInterval(timer);
  }, [order, reload]);

  // La compra se registra cuando el pago queda confirmado, no al enviar el
  // pedido: con una pasarela con redireccion, enviar no es pagar.
  const purchaseTracked = useRef(false);
  useEffect(() => {
    if (!order || purchaseTracked.current) return;
    if (order.status === OrderStatus.PENDING_PAYMENT) return;
    if (order.status === OrderStatus.CANCELED) return;
    purchaseTracked.current = true;
    track(AnalyticsEvent.PURCHASE, { value: order.totalCents });
  }, [order]);

  if (loading && !order) return <Spinner label={t('common.loading')} />;
  if (error || !order || !venue) {
    return (
      <div className="container" style={{ paddingTop: 24 }}>
        <ErrorState message={error?.message ?? t('common.error')} onRetry={reload} />
      </div>
    );
  }

  const currentIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);

  return (
    <div className="container stack stack-5" style={{ paddingTop: 20 }}>
      <header className="stack stack-2 center">
        <span className="small muted">{t('order.title', { code: '' })}</span>
        <h1 style={{ fontSize: '2.2rem', letterSpacing: '0.08em' }}>{order.code}</h1>
        <p className="bold" style={{ color: 'var(--brand)' }}>
          {t(`order.status.${order.status}`)}
        </p>
        <p className="tiny muted">{relativeTime(order.createdAt, locale)}</p>
      </header>

      {order.status === OrderStatus.PENDING_PAYMENT && (
        <div
          className="card card-pad stack stack-2"
          role="status"
          style={{ borderColor: 'var(--warning)' }}
        >
          <span className="bold small" style={{ color: 'var(--warning)' }}>
            Esperando la confirmacion del pago
          </span>
          <p className="small secondary">
            Si ya pagaste, puede tardar unos segundos en acreditarse. Esta pantalla
            se actualiza sola; no hace falta que pagues de nuevo.
          </p>
        </div>
      )}

      {/* Progreso: el estado actual se marca con texto y con peso, no solo con
          color, para que se entienda sin distinguir tonos. */}
      <ol className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {STEPS.map((step, index) => {
          const done = currentIndex >= index && currentIndex !== -1;
          const current = currentIndex === index;
          return (
            <li key={step} className="row" style={{ gap: 10 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  flex: '0 0 auto',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  color: done ? 'var(--brand-ink)' : 'var(--text-muted)',
                  background: done ? 'var(--brand)' : 'var(--surface-3)',
                }}
              >
                {done ? '✓' : index + 1}
              </span>
              <span className={current ? 'bold' : 'secondary'}>
                {t(`order.status.${step}`)}
              </span>
            </li>
          );
        })}
      </ol>

      <section className="card card-pad stack stack-2">
        {order.items.map((item) => (
          <div key={item.id} className="row-between small">
            <span className="secondary">
              {item.quantity}× {item.dishName}
            </span>
            <span className="nums">{money(item.totalCents, order.currency, locale)}</span>
          </div>
        ))}
        <hr className="divider" />
        <div className="row-between">
          <span className="bold">{t('cart.total')}</span>
          <span className="bold nums">
            {money(order.totalCents, order.currency, locale)}
          </span>
        </div>
        {order.pointsEarned > 0 && (
          <p className="tiny" style={{ color: 'var(--good)' }}>
            {t('order.earned', { n: order.pointsEarned })}
          </p>
        )}
      </section>

      <Link to={`/m/${slug}`} className="btn btn-block">
        {t('cart.emptyCta')}
      </Link>
    </div>
  );
}
