/**
 * Embudo de la visita: abrir la carta -> abrir un plato -> ver en 3D -> agregar
 * -> comprar.
 *
 * Marcas ordinales, asi que el color es una rampa de un solo tono de claro a
 * oscuro (nunca ocho colores distintos: las etapas tienen orden, no identidad).
 * El paso mas claro arranca en el escalon 250 de la rampa para no perder
 * contraste contra la superficie.
 */
import type { FunnelStageDto } from '@men3d/shared';
import type { ReactNode } from 'react';

import { integer, percent } from '../../lib/format.js';
import { ChartFrame, barPathHorizontal, useTooltip } from './primitives.js';

const STAGE_LABELS: Record<FunnelStageDto['stage'], string> = {
  MENU_OPEN: 'Abre la carta',
  DISH_OPEN: 'Abre un plato',
  DISH_VIEW_3D: 'Mira el 3D',
  ADD_TO_CART: 'Agrega al pedido',
  PURCHASE: 'Compra',
};

const RAMP = [
  'var(--ordinal-5)',
  'var(--ordinal-4)',
  'var(--ordinal-3)',
  'var(--ordinal-2)',
  'var(--ordinal-1)',
];

export function FunnelChart({
  stages,
  locale,
}: {
  stages: FunnelStageDto[];
  locale: string;
}): ReactNode {
  const { show, hide, containerRef, element } = useTooltip();
  const top = stages[0]?.sessions ?? 0;

  if (top === 0) {
    return (
      <ChartFrame title="Embudo de la visita">
        <p className="small muted">Sin visitas registradas en este periodo.</p>
      </ChartFrame>
    );
  }

  const BAR = 22;
  const ROW = BAR + 14;
  const LABEL_WIDTH = 128;
  const plotWidth = 330;
  const height = stages.length * ROW + 8;

  return (
    <ChartFrame
      title="Embudo de la visita"
      subtitle="Donde se cae la gente entre abrir la carta y pedir."
      table={
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Etapa</th>
                <th scope="col" className="num">Sesiones</th>
                <th scope="col" className="num">% del inicio</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage) => (
                <tr key={stage.stage}>
                  <th scope="row">{STAGE_LABELS[stage.stage]}</th>
                  <td className="num">{integer(stage.sessions, locale)}</td>
                  <td className="num">{percent(stage.rateFromTop, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    >
      <div className="chart" ref={containerRef} style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${LABEL_WIDTH + plotWidth + 60} ${height}`}
          role="img"
          aria-label="Embudo de conversion por etapa"
        >
          {stages.map((stage, index) => {
            const y = index * ROW + 4;
            const width = (stage.sessions / top) * plotWidth;
            const previous = stages[index - 1];
            const dropped = previous ? previous.sessions - stage.sessions : 0;

            return (
              <g key={stage.stage}>
                <text
                  className="chart-label"
                  x={LABEL_WIDTH - 10}
                  y={y + BAR / 2 + 4}
                  textAnchor="end"
                >
                  {STAGE_LABELS[stage.stage]}
                </text>
                <path
                  d={barPathHorizontal(LABEL_WIDTH, y, width, BAR)}
                  fill={RAMP[index] ?? RAMP[RAMP.length - 1]}
                />
                <text
                  className="chart-value"
                  x={LABEL_WIDTH + width + 8}
                  y={y + BAR / 2 + 4}
                >
                  {percent(stage.rateFromTop, locale)}
                </text>
                <rect
                  className="chart-hit"
                  x={LABEL_WIDTH}
                  y={y - 4}
                  width={plotWidth + 56}
                  height={ROW}
                  tabIndex={0}
                  role="button"
                  aria-label={`${STAGE_LABELS[stage.stage]}: ${stage.sessions} sesiones, ${stage.rateFromTop}% del inicio`}
                  onMouseEnter={(event) =>
                    show(
                      event,
                      <div className="stack" style={{ gap: 2 }}>
                        <strong>{STAGE_LABELS[stage.stage]}</strong>
                        <span className="nums">
                          {integer(stage.sessions, locale)} sesiones
                        </span>
                        {dropped > 0 && (
                          <span className="nums muted">
                            se cayeron {integer(dropped, locale)} en este paso
                          </span>
                        )}
                      </div>,
                    )
                  }
                  onMouseLeave={hide}
                  onFocus={(event) => show(event, <strong>{STAGE_LABELS[stage.stage]}</strong>)}
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
