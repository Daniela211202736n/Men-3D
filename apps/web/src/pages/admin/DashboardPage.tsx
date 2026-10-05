/**
 * Resumen de metricas.
 *
 * El orden responde a lo que el dueño pregunta primero: cuanto entro, cuanta
 * gente vino, y despues el dato que ningun menu de papel puede darle — que
 * platos se miran mucho en 3D y se piden poco.
 */
import { useState, type ReactNode } from 'react';

import { FunnelChart } from '../../components/charts/FunnelChart.js';
import { LookToBookChart } from '../../components/charts/LookToBookChart.js';
import { StatTile } from '../../components/charts/StatTile.js';
import { TrendChart } from '../../components/charts/TrendChart.js';
import { ErrorState, Spinner } from '../../components/ui.js';
import { adminApi } from '../../lib/api.js';
import { compactNumber, integer, moneyRound, percent } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';

const RANGES = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
];

export function DashboardPage(): ReactNode {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useAsync(
    (signal) => adminApi.analytics(days, signal),
    [days],
  );

  if (loading && !data) return <Spinner label="Calculando metricas" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;

  const { totals } = data;

  return (
    <div className="stack stack-5">
      <header className="row-between wrap">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Resumen</h1>
          <p className="small muted">Ultimos {data.rangeDays} dias</p>
        </div>
        {/* Los filtros de rango van en una sola fila arriba de los graficos. */}
        <div className="row" style={{ gap: 6 }}>
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              className="chip"
              aria-pressed={days === range.days}
              onClick={() => setDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid-stats">
        <StatTile
          label="Facturacion"
          value={moneyRound(totals.revenueCents, data.currency)}
          hint={`${integer(totals.orders)} pedidos`}
        />
        <StatTile
          label="Visitas a la carta"
          value={compactNumber(totals.uniqueSessions)}
          hint={`${integer(totals.menuOpens)} aperturas`}
        />
        <StatTile
          label="Vistas en 3D"
          value={compactNumber(totals.views3d)}
          hint={`${percent(totals.view3dRate)} de los platos abiertos`}
        />
        <StatTile
          label="Veces en realidad aumentada"
          value={compactNumber(totals.arLaunches)}
          hint="El comensal lo apoyo en su mesa"
        />
        <StatTile
          label="Conversion a pedido"
          value={percent(totals.conversionRate)}
          hint="Sesiones que terminaron comprando"
        />
        <StatTile
          label="Ticket promedio"
          value={
            totals.orders === 0
              ? '—'
              : moneyRound(Math.round(totals.revenueCents / totals.orders), data.currency)
          }
        />
      </div>

      <LookToBookChart rows={data.topDishes} locale="es" />

      <div
        className="stack stack-5"
        style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr' }}
      >
        <TrendChart points={data.timeseries} currency={data.currency} locale="es" />
        <FunnelChart stages={data.funnel} locale="es" />
      </div>

      {data.topSearches.length > 0 && (
        <section className="card card-pad stack stack-3">
          <div className="stack" style={{ gap: 2 }}>
            <h3>Que busca la gente</h3>
            <p className="small muted">
              Las busquedas sin resultado son huecos de carta — o palabras que tus
              platos no usan.
            </p>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Termino</th>
                  <th scope="col" className="num">Busquedas</th>
                  <th scope="col" className="num">Sin resultado</th>
                  <th scope="col">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {data.topSearches.map((row) => (
                  <tr key={row.term}>
                    <th scope="row">{row.term}</th>
                    <td className="num">{integer(row.searches)}</td>
                    <td className="num">{integer(row.zeroResults)}</td>
                    <td>
                      {row.zeroResults > 0 && row.zeroResults === row.searches && (
                        <span className="badge badge-critical">nunca encontro nada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
