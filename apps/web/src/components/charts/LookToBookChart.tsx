/**
 * El grafico que responde la pregunta del dueño: "¿que platos miran en 3D y
 * cuales terminan pidiendo?".
 *
 * Dos series en barras agrupadas sobre un eje unico. Que compartan eje es
 * legitimo aqui porque ambas cuentan *eventos por plato* y conviven en el mismo
 * orden de magnitud; cuando no lo hacen (vistas contra facturacion, por caso) se
 * usan dos graficos separados, nunca dos ejes.
 */
import type { DishPerformanceRowDto } from '@men3d/shared';
import type { ReactNode } from 'react';

import { integer, percent } from '../../lib/format.js';
import {
  ChartFrame,
  LegendKey,
  barPathHorizontal,
  niceTicks,
  useTooltip,
} from './primitives.js';

const SERIES = {
  views: { color: 'var(--series-1)', label: 'Vistas en 3D' },
  sold: { color: 'var(--series-2)', label: 'Unidades vendidas' },
} as const;

/** Alto de cada barra y separacion; el hueco de 2px lo hace la superficie. */
const BAR = 11;
const GAP = 2;
const ROW = BAR * 2 + GAP + 20;
const LABEL_WIDTH = 150;

export function LookToBookChart({
  rows,
  locale,
}: {
  rows: DishPerformanceRowDto[];
  locale: string;
}): ReactNode {
  const { show, hide, containerRef, element } = useTooltip();
  const data = rows.slice(0, 8);

  if (data.length === 0) {
    return (
      <ChartFrame title="Interes visual contra ventas reales">
        <p className="small muted">
          Todavia no hay suficientes visitas para comparar.
        </p>
      </ChartFrame>
    );
  }

  const max = Math.max(...data.flatMap((d) => [d.views3d, d.unitsSold]), 1);
  const ticks = niceTicks(max);
  const axisMax = ticks[ticks.length - 1] ?? max;
  const plotWidth = 420;
  const height = data.length * ROW + 26;
  const scale = (value: number) => (value / axisMax) * plotWidth;

  return (
    <ChartFrame
      title="Interes visual contra ventas reales"
      subtitle="Mucho mirar y poco pedir suele ser un problema de precio, de descripcion o de porcion."
      legend={
        <>
          <LegendKey color={SERIES.views.color} label={SERIES.views.label} />
          <LegendKey color={SERIES.sold.color} label={SERIES.sold.label} />
        </>
      }
      table={<PerformanceTable rows={data} locale={locale} />}
    >
      <div className="chart" ref={containerRef} style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${LABEL_WIDTH + plotWidth + 44} ${height}`}
          role="img"
          aria-label="Barras agrupadas: vistas en 3D y unidades vendidas por plato"
        >
          {/* Lineas de referencia: finas, solidas y por detras de los datos. */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={LABEL_WIDTH + scale(tick)}
                x2={LABEL_WIDTH + scale(tick)}
                y1={16}
                y2={height - 10}
              />
              <text
                className="chart-axis-text"
                x={LABEL_WIDTH + scale(tick)}
                y={10}
                textAnchor="middle"
              >
                {integer(tick, locale)}
              </text>
            </g>
          ))}

          {data.map((row, index) => {
            const top = 20 + index * ROW;
            const viewsWidth = scale(row.views3d);
            const soldWidth = scale(row.unitsSold);
            const tooltip = (
              <div className="stack" style={{ gap: 2 }}>
                <strong>{row.dishName}</strong>
                <span className="nums">
                  {integer(row.views3d, locale)} vistas en 3D
                </span>
                <span className="nums">
                  {integer(row.unitsSold, locale)} vendidos
                </span>
                <span className="nums muted">
                  conversion {percent(row.lookToBookRate, locale)} · {row.avgViewSeconds}s
                  de vista
                </span>
              </div>
            );

            return (
              <g key={row.dishId}>
                <text
                  className="chart-label"
                  x={LABEL_WIDTH - 10}
                  y={top + BAR + 1}
                  textAnchor="end"
                >
                  {row.dishName.length > 22
                    ? `${row.dishName.slice(0, 21)}…`
                    : row.dishName}
                </text>

                <path
                  d={barPathHorizontal(LABEL_WIDTH, top, viewsWidth, BAR)}
                  fill={SERIES.views.color}
                />
                <path
                  d={barPathHorizontal(
                    LABEL_WIDTH,
                    top + BAR + GAP,
                    soldWidth,
                    BAR,
                  )}
                  fill={SERIES.sold.color}
                />

                {/* Solo se rotula el valor de la serie de ventas: etiquetar todo
                    convierte el grafico en una tabla ilegible. */}
                <text
                  className="chart-value"
                  x={LABEL_WIDTH + Math.max(viewsWidth, soldWidth) + 7}
                  y={top + BAR + 2}
                >
                  {percent(row.lookToBookRate, locale)}
                </text>

                {/* Zona de interaccion mas alta que las barras, para el dedo. */}
                <rect
                  className="chart-hit"
                  x={LABEL_WIDTH}
                  y={top - 4}
                  width={plotWidth + 40}
                  height={ROW - 8}
                  tabIndex={0}
                  role="button"
                  aria-label={`${row.dishName}: ${row.views3d} vistas, ${row.unitsSold} vendidos`}
                  onMouseEnter={(event) => show(event, tooltip)}
                  onMouseLeave={hide}
                  onFocus={(event) => show(event, tooltip)}
                  onBlur={hide}
                />
              </g>
            );
          })}
        </svg>
        {element}
      </div>
    </ChartFrame>
  );
}

function PerformanceTable({
  rows,
  locale,
}: {
  rows: DishPerformanceRowDto[];
  locale: string;
}): ReactNode {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Plato</th>
            <th scope="col" className="num">Vistas 3D</th>
            <th scope="col" className="num">RA</th>
            <th scope="col" className="num">Vendidos</th>
            <th scope="col" className="num">Conversion</th>
            <th scope="col" className="num">Vista media</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dishId}>
              <th scope="row" style={{ fontWeight: 600 }}>{row.dishName}</th>
              <td className="num">{integer(row.views3d, locale)}</td>
              <td className="num">{integer(row.arLaunches, locale)}</td>
              <td className="num">{integer(row.unitsSold, locale)}</td>
              <td className="num">{percent(row.lookToBookRate, locale)}</td>
              <td className="num">{row.avgViewSeconds}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
