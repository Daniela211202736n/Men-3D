/**
 * Piezas comunes de los graficos.
 *
 * Decisiones que valen para todos (y que no se negocian por grafico):
 *  - un solo eje de valores: dos medidas de escala distinta van en dos graficos,
 *    nunca en dos ejes Y sobre el mismo dibujo;
 *  - el color lo llevan las marcas; los textos usan tokens de ink, jamas el
 *    color de la serie (un amarillo es ilegible como texto);
 *  - toda serie tiene su vista de tabla, para lectores de pantalla y para el
 *    caso en que el color no alcance.
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Tooltip posicionado sobre un contenedor relativo. */
export function useTooltip(): {
  tooltip: TooltipState | null;
  show: (event: React.MouseEvent | React.FocusEvent, content: ReactNode) => void;
  hide: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  element: ReactNode;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const show = useCallback(
    (event: React.MouseEvent | React.FocusEvent, content: ReactNode) => {
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const target = (event.target as Element).getBoundingClientRect();
      // Se ancla al centro superior de la marca, no al puntero: asi el tooltip
      // no tiembla mientras el dedo se mueve.
      setTooltip({
        x: target.left - bounds.left + target.width / 2,
        y: target.top - bounds.top,
        content,
      });
    },
    [],
  );

  const hide = useCallback(() => setTooltip(null), []);

  const element = tooltip ? (
    <div
      className="chart-tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
    >
      {tooltip.content}
    </div>
  ) : null;

  return { tooltip, show, hide, containerRef, element };
}

/**
 * Escalones redondos para el eje de valores (0 / 50 / 100, no 0 / 47 / 94).
 *
 * El ultimo escalon siempre queda en o por encima del maximo: los graficos usan
 * ese valor como tope de la escala, asi que si se quedara corto las barras se
 * dibujarian fuera del area util.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  // Se redondea el tope hacia arriba al siguiente multiplo del escalon.
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step * 0.001; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

/**
 * Extremo redondeado solo del lado del dato: la barra nace cuadrada en la linea
 * base y termina con 4px de radio en la punta.
 */
export function barPathHorizontal(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  const r = Math.min(radius, width, height / 2);
  if (width <= 0) return '';
  if (r <= 0) return `M${x},${y}h${width}v${height}h${-width}z`;
  return [
    `M${x},${y}`,
    `h${width - r}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${height - 2 * r}`,
    `a${r},${r} 0 0 1 ${-r},${r}`,
    `h${-(width - r)}`,
    'z',
  ].join('');
}

/** Clave de leyenda: cuadradito de color + texto en ink. */
export function LegendKey({
  color,
  label,
}: {
  color: string;
  label: string;
}): ReactNode {
  return (
    <span className="chart-legend-key">
      <span className="chart-swatch" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Contenedor con titulo, leyenda y acceso a la tabla de datos. */
export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  table,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
  table?: ReactNode;
}): ReactNode {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="card card-pad stack stack-4">
      <header className="row-between wrap" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <h3>{title}</h3>
          {subtitle && <p className="small muted">{subtitle}</p>}
        </div>
        {table && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Ver grafico' : 'Ver tabla'}
          </button>
        )}
      </header>

      {legend && <div className="chart-legend">{legend}</div>}

      {showTable && table ? table : children}
    </section>
  );
}
