/**
 * Evolucion diaria.
 *
 * Vistas en 3D y pedidos son medidas distintas y de escala distinta, asi que van
 * en dos graficos chicos apilados que comparten el eje de fechas — no en dos
 * ejes Y sobre el mismo dibujo. Cada panel tiene una sola serie, por lo que no
 * necesita leyenda: el titulo del panel ya dice que se esta mirando.
 */
import type { TimeseriesPointDto } from '@men3d/shared';
import { useState, type ReactNode } from 'react';

import { integer, money, shortDate } from '../../lib/format.js';
import { ChartFrame, niceTicks, useTooltip } from './primitives.js';

interface Panel {
  key: 'views3d' | 'orders';
  title: string;
  color: string;
  format: (value: number) => string;
}

export function TrendChart({
  points,
  currency,
  locale,
}: {
  points: TimeseriesPointDto[];
  currency: string;
  locale: string;
}): ReactNode {
  const panels: Panel[] = [
    {
      key: 'views3d',
      title: 'Vistas en 3D por dia',
      color: 'var(--series-1)',
      format: (v) => integer(v, locale),
    },
    {
      key: 'orders',
      title: 'Pedidos por dia',
      color: 'var(--series-2)',
      format: (v) => integer(v, locale),
    },
  ];

  return (
    <ChartFrame
      title="Evolucion diaria"
      subtitle="Dos medidas distintas, dos escalas: cada una con su propio eje vertical en su panel."
      table={
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col" className="num">Vistas 3D</th>
                <th scope="col" className="num">Pedidos</th>
                <th scope="col" className="num">Facturacion</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{shortDate(point.date, locale)}</th>
                  <td className="num">{integer(point.views3d, locale)}</td>
                  <td className="num">{integer(point.orders, locale)}</td>
                  <td className="num">{money(point.revenueCents, currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="stack stack-4">
        {panels.map((panel) => (
          <SmallMultiple
            key={panel.key}
            panel={panel}
            points={points}
            currency={currency}
            locale={locale}
          />
        ))}
      </div>
    </ChartFrame>
  );
}

function SmallMultiple({
  panel,
  points,
  currency,
  locale,
}: {
  panel: Panel;
  points: TimeseriesPointDto[];
  currency: string;
  locale: string;
}): ReactNode {
  const { show, hide, containerRef, element } = useTooltip();
  const [hover, setHover] = useState<number | null>(null);

  const width = 520;
  const height = 110;
  const padLeft = 38;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 20;

  const values = points.map((p) => p[panel.key]);
  const max = Math.max(...values, 1);
  const ticks = niceTicks(max, 2);
  const axisMax = ticks[ticks.length - 1] ?? max;

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const x = (index: number) => padLeft + index * stepX;
  const y = (value: number) => padTop + plotHeight - (value / axisMax) * plotHeight;

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point[panel.key])}`)
    .join(' ');
  // El area es un lavado del tono de la serie, nunca un bloque saturado.
  const area =
    points.length > 0
      ? `${line} L${x(points.length - 1)},${padTop + plotHeight} L${padLeft},${padTop + plotHeight} Z`
      : '';

  // Se rotulan la primera, la ultima y el maximo: nada mas.
  const peakIndex = values.indexOf(Math.max(...values));

  return (
    <div className="stack stack-2">
      <span className="small bold secondary">{panel.title}</span>
      <div className="chart" ref={containerRef} style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={panel.title}
          onMouseLeave={() => {
            setHover(null);
            hide();
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={padLeft}
                x2={width - padRight}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="chart-axis-text"
                x={padLeft - 7}
                y={y(tick) + 4}
                textAnchor="end"
              >
                {panel.format(tick)}
              </text>
            </g>
          ))}

          <path d={area} fill={panel.color} opacity="0.1" />
          <path
            d={line}
            fill="none"
            stroke={panel.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Marcador del punto maximo, con anillo del color de la superficie
              para que se lea aunque caiga sobre la linea. */}
          {peakIndex >= 0 && points[peakIndex] && (
            <>
              <circle
                cx={x(peakIndex)}
                cy={y(points[peakIndex]![panel.key])}
                r="4.5"
                fill={panel.color}
                stroke="var(--surface-1)"
                strokeWidth="2"
              />
              <text
                className="chart-value"
                x={x(peakIndex)}
                y={y(points[peakIndex]![panel.key]) - 9}
                textAnchor="middle"
              >
                {panel.format(points[peakIndex]![panel.key])}
              </text>
            </>
          )}

          {hover !== null && points[hover] && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padTop}
              y2={padTop + plotHeight}
              stroke="var(--text-muted)"
              strokeWidth="1"
            />
          )}

          {/* Franja invisible por punto: el objetivo tactil es toda la columna. */}
          {points.map((point, index) => (
            <rect
              key={point.date}
              className="chart-hit"
              x={x(index) - stepX / 2}
              y={padTop}
              width={Math.max(stepX, 6)}
              height={plotHeight}
              onMouseEnter={(event) => {
                setHover(index);
                show(
                  event,
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{shortDate(point.date, locale)}</strong>
                    <span className="nums">
                      {integer(point.views3d, locale)} vistas en 3D
                    </span>
                    <span className="nums">
                      {integer(point.orders, locale)} pedidos
                    </span>
                    <span className="nums muted">
                      {money(point.revenueCents, currency, locale)}
                    </span>
                  </div>,
                );
              }}
            />
          ))}

          {points.length > 0 && (
            <>
              <text
                className="chart-axis-text"
                x={padLeft}
                y={height - 5}
                textAnchor="start"
              >
                {shortDate(points[0]!.date, locale)}
              </text>
              <text
                className="chart-axis-text"
                x={width - padRight}
                y={height - 5}
                textAnchor="end"
              >
                {shortDate(points[points.length - 1]!.date, locale)}
              </text>
            </>
          )}
        </svg>
        {element}
      </div>
    </div>
  );
}
