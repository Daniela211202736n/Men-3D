/**
 * Indicador suelto. El numero grande usa cifras proporcionales (las tabulares
 * se ven flojas a tamaño grande) y la variacion lleva signo y periodo, nunca
 * un color solo.
 */
import type { ReactNode } from 'react';

export function StatTile({
  label,
  value,
  hint,
  delta,
  deltaGoodWhenUp = true,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { value: number; period: string };
  deltaGoodWhenUp?: boolean;
}): ReactNode {
  const up = (delta?.value ?? 0) > 0;
  const good = up === deltaGoodWhenUp;

  return (
    <div className="card card-pad stack" style={{ gap: 6 }}>
      <span className="small secondary">{label}</span>
      {/* El tamaño se adapta al ancho de la tarjeta: un importe de siete
          digitos y un "33,6%" no pueden pedir la misma caja, y lo que no entra
          no se recorta —se lee mal un numero al que le falta el final—. */}
      <span className="stat-valor" title={value}>
        {value}
      </span>
      {delta && delta.value !== 0 && (
        <span
          className="tiny bold"
          style={{ color: good ? 'var(--good)' : 'var(--critical)' }}
        >
          {up ? '▲' : '▼'} {Math.abs(delta.value)}% {delta.period}
        </span>
      )}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}
