/**
 * Carrito y checkout.
 *
 * El total se muestra calculado con la misma funcion que usa el backend
 * (`computeOrderTotals` de @men3d/shared), asi el numero que ve el comensal
 * antes de pagar es exactamente el que se cobra.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LOYALTY_POINTS, computeOrderTotals } from '@men3d/shared';

import { EmptyState, QuantityStepper, Spinner } from '../../components/ui.js';
import { AnalyticsEvent, track } from '../../lib/analytics.js';
import { ApiError, publicApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { getGuestId, getTable } from '../../lib/session.js';
import { useAsync } from '../../lib/useAsync.js';
import { useCart } from '../../store/cart.js';
import { useToast } from '../../store/toast.js';
import { useVenue } from '../../store/venue.js';

export function CartPage(): ReactNode {
  const { slug, venue, locale, t } = useVenue();
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const guestId = getGuestId();
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [sending, setSending] = useState(false);

  const { data: loyalty } = useAsync(
    (signal) => publicApi.loyalty(slug, guestId, signal),
    [slug, guestId],
  );

  if (!venue) return <Spinner />;

  if (cart.lines.length === 0) {
    return (
      <div className="container" style={{ paddingTop: 32 }}>
        <EmptyState
          title={t('cart.empty')}
          action={
            <Link to={`/m/${slug}`} className="btn btn-primary btn-sm">
              {t('cart.emptyCta')}
            </Link>
          }
        />
      </div>
    );
  }

  const balance = loyalty?.balance ?? 0;
  // Se canjea como maximo lo que alcanza para el subtotal, en multiplos exactos
  // del ratio de conversion (la misma regla que aplica el backend).
  const redeemablePoints = usePoints
    ? Math.min(
        balance - (balance % LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT),
        Math.floor(cart.subtotalCents / 100) * LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT,
      )
    : 0;
  const discountCents =
    (redeemablePoints / LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT) * 100;

  const totals = computeOrderTotals(
    cart.lines.map((line) => ({
      unitPriceCents: line.priceCents,
      quantity: line.quantity,
    })),
    { taxRateBps: venue.taxRateBps, discountCents },
  );

  const checkout = async () => {
    if (sending) return;
    setSending(true);
    try {
      const { order } = await publicApi.createOrder(slug, {
        items: cart.lines.map((line) => ({
          dishId: line.dishId,
          quantity: line.quantity,
          notes: line.notes,
        })),
        serviceMode: 'DINE_IN',
        tableLabel: getTable(),
        customerName: customerName || undefined,
        notes: notes || undefined,
        redeemPoints: redeemablePoints || undefined,
        guestId,
      });
      track(AnalyticsEvent.PURCHASE, { value: order.totalCents });
      cart.clear();
      navigate(`/m/${slug}/pedido/${order.code}`);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : t('common.error'),
        'error',
      );
    } finally {
      setSending(false);
    }
  };

  const table = getTable();

  return (
    <div className="container stack stack-5" style={{ paddingTop: 16 }}>
      <h1>{t('cart.title')}</h1>
      {table && (
        <p className="small muted">
          {t('cart.table')} {table}
        </p>
      )}

      <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {cart.lines.map((line) => (
          <li key={line.dishId} className="card card-pad row-between">
            <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
              <span className="bold small truncate">{line.name}</span>
              <span className="tiny muted nums">
                {money(line.priceCents, venue.currency, locale)} {t('common.of')} unidad
              </span>
              {line.notes && <span className="tiny muted">{line.notes}</span>}
            </div>
            <div className="stack" style={{ alignItems: 'flex-end', gap: 6 }}>
              <span className="small bold nums">
                {money(line.priceCents * line.quantity, venue.currency, locale)}
              </span>
              <QuantityStepper
                value={line.quantity}
                onChange={(quantity) => cart.setQuantity(line.dishId, quantity)}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="stack stack-3">
        <label className="field">
          <span className="label">{t('cart.name')}</span>
          <input
            className="input"
            value={customerName}
            maxLength={80}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">{t('cart.notes')}</span>
          <textarea
            className="textarea"
            value={notes}
            maxLength={400}
            placeholder="Sin sal, coccion a punto..."
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>

      {venue.features.includes('LOYALTY') && balance > 0 && (
        <label className="card card-pad row-between" style={{ cursor: 'pointer' }}>
          <span className="stack" style={{ gap: 2 }}>
            <span className="small bold">{t('cart.pointsBalance', { n: balance })}</span>
            <span className="tiny muted">
              {t('cart.points', {
                n: redeemablePoints || balance,
                amount: money(
                  (Math.min(
                    balance - (balance % LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT),
                    Math.floor(cart.subtotalCents / 100) *
                      LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT,
                  ) /
                    LOYALTY_POINTS.POINTS_PER_CURRENCY_UNIT) *
                    100,
                  venue.currency,
                  locale,
                ),
              })}
            </span>
          </span>
          <input
            type="checkbox"
            checked={usePoints}
            onChange={(e) => setUsePoints(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
        </label>
      )}

      <div className="card card-pad stack stack-2">
        <Row label={t('cart.subtotal')} value={money(totals.subtotalCents, venue.currency, locale)} />
        {totals.discountCents > 0 && (
          <Row
            label={t('cart.discount')}
            value={`− ${money(totals.discountCents, venue.currency, locale)}`}
          />
        )}
        {venue.taxRateBps > 0 && (
          <Row
            label={`${t('cart.tax')} (${venue.taxRateBps / 100}%)`}
            value={money(totals.taxCents, venue.currency, locale)}
          />
        )}
        <hr className="divider" />
        <div className="row-between">
          <span className="bold">{t('cart.total')}</span>
          <span className="bold nums" style={{ fontSize: '1.15rem' }}>
            {money(totals.totalCents, venue.currency, locale)}
          </span>
        </div>
      </div>

      <div className="sticky-bottom">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void checkout()}
          disabled={sending}
        >
          {sending ? t('common.loading') : t('cart.checkout')}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="row-between small">
      <span className="secondary">{label}</span>
      <span className="nums">{value}</span>
    </div>
  );
}
