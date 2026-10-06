/** Piezas chicas reutilizadas en toda la app. */
import { useState, type ReactNode } from 'react';

/**
 * Miniatura de un plato.
 *
 * Es un componente y no un `<img>` por tres cosas que no se ven en el markup:
 *
 *  - los renders de los modelos llegan con fondo transparente, asi que debajo
 *    va un degradado; sobre un plano quedan recortados contra la nada;
 *  - una foto que no carga —un CDN con hipo, una URL vieja— no puede dejarle al
 *    comensal el icono de imagen rota del navegador;
 *  - sin foto hay que decir algo igual, y lo que dice es un plato dibujado, con
 *    el cubo encima si ademas hay modelo 3D.
 *
 * Estaba resuelto solo en la fila de la carta. Esto lo pone tambien en el
 * carrito, que es donde el comensal decide si confirma.
 */
export function Miniatura({
  src,
  has3d = false,
  size = 112,
  radius,
}: {
  src?: string | null;
  has3d?: boolean;
  size?: number;
  radius?: number;
}): ReactNode {
  const [rota, setRota] = useState(false);
  return (
    <span
      className="dish-thumb"
      style={{ width: size, height: size, ...(radius ? { borderRadius: radius } : {}) }}
    >
      {src && !rota ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setRota(true)}
        />
      ) : (
        <PlatoGlifo has3d={has3d} size={Math.round(size * 0.38)} />
      )}
    </span>
  );
}

/** El plato dibujado del respaldo; con el cubo si el plato tiene modelo. */
export function PlatoGlifo({
  has3d,
  size = 40,
}: {
  has3d: boolean;
  size?: number;
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
      style={{ color: 'var(--text-muted)' }}
    >
      <ellipse cx="24" cy="30" rx="16" ry="6" />
      <ellipse cx="24" cy="29" rx="10" ry="3.4" opacity="0.5" />
      {has3d && <path d="M24 10l8 4.5v9L24 28l-8-4.5v-9z" />}
    </svg>
  );
}

export function Stars({
  value,
  size = 14,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}): ReactNode {
  const rounded = Math.round(value);
  return (
    <span
      className="stars"
      role="img"
      aria-label={label ?? `${value} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} filled={n <= rounded} />
      ))}
    </span>
  );
}

export function StarIcon({
  size = 14,
  filled = true,
}: {
  size?: number;
  filled?: boolean;
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      style={{ opacity: filled ? 1 : 0.35 }}
    >
      <path d="M12 2.6l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.67l-5.9 3.1 1.13-6.57L2.45 9.54l6.6-.96z" />
    </svg>
  );
}

/** Puntuacion interactiva para el formulario de opinion. */
export function StarInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}): ReactNode {
  return (
    <div role="radiogroup" aria-label={label} className="row" style={{ gap: 0 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} de 5`}
          className={`star-btn${n <= value ? ' is-on' : ''}`}
          onClick={() => onChange(n)}
        >
          <StarIcon size={26} filled={n <= value} />
        </button>
      ))}
    </div>
  );
}

export function SearchIcon(): ReactNode {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </svg>
  );
}

export function Spinner({ label }: { label?: string }): ReactNode {
  return (
    <div className="row" style={{ justifyContent: 'center', padding: 28 }}>
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label ?? 'Cargando'}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Reintentar',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}): ReactNode {
  return (
    <div className="empty stack stack-3" style={{ alignItems: 'center' }}>
      <p className="secondary">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="empty stack stack-3" style={{ alignItems: 'center' }}>
      <p className="bold" style={{ color: 'var(--text-secondary)' }}>
        {title}
      </p>
      {body && <p className="small">{body}</p>}
      {action}
    </div>
  );
}

/** Insignia "3D" que marca los platos con modelo cargado. */
export function Badge3D(): ReactNode {
  return (
    <span className="badge badge-3d" title="Se puede ver en 3D y en realidad aumentada">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      </svg>
      3D
    </span>
  );
}

/** Contador +/- usado en el carrito. */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = 50,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}): ReactNode {
  return (
    <div className="row" style={{ gap: 4 }}>
      <button
        type="button"
        className="btn btn-sm"
        aria-label="Quitar uno"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        style={{ minWidth: 34, padding: '4px 8px' }}
      >
        −
      </button>
      <span
        className="nums bold"
        aria-live="polite"
        style={{ minWidth: 26, textAlign: 'center' }}
      >
        {value}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        aria-label="Agregar uno"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        style={{ minWidth: 34, padding: '4px 8px' }}
      >
        +
      </button>
    </div>
  );
}
