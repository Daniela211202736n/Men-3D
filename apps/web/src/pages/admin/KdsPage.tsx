/**
 * Pantalla de cocina (KDS).
 *
 * Escucha el stream SSE del backend para que un pedido nuevo aparezca sin que
 * nadie refresque. Se eligio SSE sobre WebSocket porque el flujo es de ida y
 * reconecta solo.
 *
 * `EventSource` no acepta cabeceras, asi que antes de conectar se pide un ticket
 * de 60 segundos y *ese* viaja en la URL: el token de sesion nunca termina en un
 * log de proxy ni en el historial del navegador.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { KDS_COLUMNS, type OrderDto } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { minutesSince, money } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useToast } from '../../store/toast.js';

const COLUMN_LABELS: Record<string, string> = {
  PAID: 'Pagado',
  IN_KITCHEN: 'En cocina',
  READY: 'Listo',
  SERVED: 'Servido',
};

/** Siguiente estado de cada columna y el texto del boton que lo dispara. */
const NEXT_ACTION: Record<string, { status: string; label: string } | undefined> = {
  PAID: { status: 'IN_KITCHEN', label: 'Tomar' },
  IN_KITCHEN: { status: 'READY', label: 'Listo' },
  READY: { status: 'SERVED', label: 'Entregado' },
};

/** Minutos a partir de los cuales el ticket se marca como demorado. */
const LATE_MINUTES = 15;

export function KdsPage(): ReactNode {
  const toast = useToast();
  const { data: board, loading, error, reload, setData } = useAsync(
    (signal) => adminApi.kdsBoard(signal),
    [],
  );
  const [live, setLive] = useState(false);
  const retryRef = useRef(0);

  /** Inserta o reemplaza un pedido que llego por el stream. */
  const upsert = (order: OrderDto) => {
    setData((current) => {
      if (!current) return current;
      const columns = current.columns.map((column) => ({
        ...column,
        orders: column.orders.filter((o) => o.id !== order.id),
      }));
      const target = columns.find((c) => c.status === order.status);
      if (target) target.orders = [order, ...target.orders];
      return { ...current, columns };
    });
  };

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = async () => {
      if (closed) return;

      let ticket: string;
      try {
        ({ ticket } = await adminApi.kdsTicket());
      } catch {
        // Sin ticket no hay stream: se reintenta con la misma espera creciente.
        scheduleReconnect();
        return;
      }
      if (closed) return;

      source = new EventSource(
        `/api/admin/kds/stream?ticket=${encodeURIComponent(ticket)}`,
      );

      source.addEventListener('open', () => {
        setLive(true);
        retryRef.current = 0;
      });

      const onOrder = (event: MessageEvent<string>) => {
        try {
          upsert(JSON.parse(event.data) as OrderDto);
        } catch {
          // Un mensaje ilegible no debe tirar la pantalla de cocina.
        }
      };
      source.addEventListener('order.created', onOrder as EventListener);
      source.addEventListener('order.updated', onOrder as EventListener);

      source.addEventListener('error', () => {
        setLive(false);
        source?.close();
        scheduleReconnect();
      });
    };

    /**
     * Reintento con espera creciente y techo de 30 s: la cocina no puede quedarse
     * sin actualizaciones, pero tampoco martillar el servidor.
     */
    function scheduleReconnect(): void {
      if (closed) return;
      retryRef.current += 1;
      const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
      reconnectTimer = setTimeout(() => void connect(), delay);
    }

    void connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = async (order: OrderDto) => {
    const next = NEXT_ACTION[order.status];
    if (!next) return;
    try {
      const updated = await adminApi.updateOrderStatus(order.id, next.status);
      upsert(updated);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo actualizar', 'error');
      reload();
    }
  };

  if (loading && !board) return <Spinner label="Cargando el tablero" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!board) return null;

  return (
    <div className="stack stack-4">
      <header className="row-between wrap">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Cocina</h1>
          <p className="small muted">
            Los servidos quedan visibles {board.servedWindowHours} h.
          </p>
        </div>
        <span className={`badge ${live ? 'badge-good' : 'badge-warning'}`}>
          {live ? 'En vivo' : 'Reconectando'}
        </span>
      </header>

      <div className="kds-board">
        {KDS_COLUMNS.map((status) => {
          const column = board.columns.find((c) => c.status === status);
          const orders = column?.orders ?? [];
          return (
            <section key={status} className="kds-col" aria-label={COLUMN_LABELS[status]}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <strong className="small">{COLUMN_LABELS[status]}</strong>
                <span className="badge nums">{orders.length}</span>
              </div>

              {orders.length === 0 && <p className="tiny muted">Sin pedidos</p>}

              {orders.map((order) => {
                const minutes = minutesSince(order.createdAt);
                const late = minutes >= LATE_MINUTES && status !== 'SERVED';
                const action = NEXT_ACTION[status];
                return (
                  <article
                    key={order.id}
                    className={`kds-ticket${late ? ' is-late' : ''}`}
                  >
                    <div className="row-between">
                      <span className="kds-ticket-code">{order.code}</span>
                      <span className={`tiny nums ${late ? 'bold' : 'muted'}`}>
                        {minutes} min
                      </span>
                    </div>
                    {order.tableLabel && (
                      <p className="tiny muted">Mesa {order.tableLabel}</p>
                    )}
                    <ul
                      className="stack small"
                      style={{ listStyle: 'none', margin: '7px 0', padding: 0, gap: 3 }}
                    >
                      {order.items.map((item) => (
                        <li key={item.id}>
                          <span className="bold nums">{item.quantity}×</span> {item.dishName}
                          {item.notes && (
                            <span className="tiny" style={{ color: 'var(--warning)' }}>
                              {' '}
                              — {item.notes}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {order.notes && (
                      <p className="tiny" style={{ color: 'var(--warning)' }}>
                        Nota: {order.notes}
                      </p>
                    )}
                    <div className="row-between" style={{ marginTop: 8 }}>
                      <span className="tiny nums muted">
                        {money(order.totalCents, order.currency)}
                      </span>
                      {action && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void advance(order)}
                        >
                          {action.label}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
