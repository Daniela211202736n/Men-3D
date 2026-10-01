/**
 * Plan contratado, uso y funcionalidades.
 *
 * Muestra el modelo comercial tal cual se cobra: suscripcion mensual mas el
 * cobro unico de configuracion inicial (carga de carta y modelado 3D).
 */
import type { ReactNode } from 'react';

import { Feature, PLAN_FEATURES, type PlanTier } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { adminApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';

const FEATURE_LABELS: Record<Feature, string> = {
  AR_VIEWER: 'Visor 3D y realidad aumentada',
  ONLINE_ORDERING: 'Pedido online y pantalla de cocina',
  PAYMENTS: 'Cobro desde el celular',
  AI_PAIRINGS: 'Sugerencias de maridaje',
  AUTO_TRANSLATION: 'Traduccion automatica de la carta',
  LOYALTY: 'Programa de puntos',
  ADVANCED_ANALYTICS: 'Metricas de interes visual',
  CUSTOM_BRANDING: 'Personalizacion de marca',
};

const TIER_ORDER: PlanTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

export function PlanPage(): ReactNode {
  const { data, loading, error, reload } = useAsync((signal) => adminApi.plan(signal), []);

  if (loading && !data) return <Spinner label="Cargando el plan" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;

  const usagePercent = (used: number, max: number) =>
    max === 0 ? null : Math.min(Math.round((used / max) * 100), 100);

  const dishPercent = usagePercent(data.usage.dishes, data.usage.maxDishes);
  const modelPercent = usagePercent(data.usage.models3d, data.usage.max3dModels);

  return (
    <div className="stack stack-5" style={{ maxWidth: 680 }}>
      <header className="stack stack-2">
        <h1>Plan y uso</h1>
        <p className="small muted">
          Plan {data.tier} · estado {data.status}
          {data.trialEndsAt
            ? ` · prueba hasta ${new Date(data.trialEndsAt).toLocaleDateString('es-AR')}`
            : ''}
        </p>
      </header>

      <section className="card card-pad stack stack-3">
        <div className="row-between">
          <span className="secondary small">Suscripcion mensual</span>
          <span className="bold nums">{money(data.monthlyCents, 'ARS')}</span>
        </div>
        <div className="row-between">
          <span className="secondary small">Configuracion inicial (unico)</span>
          <span className="bold nums">
            {money(data.setupFeeCents, 'ARS')}{' '}
            {data.setupFeePaid && <span className="badge badge-good">pagado</span>}
          </span>
        </div>
        <p className="tiny muted">
          La configuracion inicial cubre la carga de la carta y el modelado 3D de los
          primeros platos.
        </p>
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Uso</h3>
        <UsageRow
          label="Platos cargados"
          used={data.usage.dishes}
          max={data.usage.maxDishes}
          percent={dishPercent}
        />
        <UsageRow
          label="Platos con modelo 3D"
          used={data.usage.models3d}
          max={data.usage.max3dModels}
          percent={modelPercent}
        />
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Funcionalidades de tu plan</h3>
        <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {Object.values(Feature).map((feature) => {
            const included = data.features.includes(feature);
            // En que plan aparece por primera vez, para sugerir la mejora.
            const availableFrom = TIER_ORDER.find((tier) =>
              (PLAN_FEATURES[tier] ?? []).includes(feature),
            );
            return (
              <li key={feature} className="row-between">
                <span className={included ? 'small' : 'small muted'}>
                  {included ? '✓' : '🔒'} {FEATURE_LABELS[feature]}
                </span>
                {!included && availableFrom && (
                  <span className="badge">desde {availableFrom}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function UsageRow({
  label,
  used,
  max,
  percent,
}: {
  label: string;
  used: number;
  max: number;
  percent: number | null;
}): ReactNode {
  // El riel sin llenar es un paso mas claro del mismo tono, para que el estado se
  // lea a lo largo de toda la barra.
  const color =
    percent === null
      ? 'var(--good)'
      : percent >= 90
        ? 'var(--critical)'
        : percent >= 70
          ? 'var(--warning)'
          : 'var(--brand)';

  return (
    <div className="stack stack-2">
      <div className="row-between small">
        <span className="secondary">{label}</span>
        <span className="nums">
          {used}
          {max === 0 ? ' (sin limite)' : ` ${'/'} ${max}`}
        </span>
      </div>
      {percent !== null && (
        <span className="rating-bar-track" aria-hidden="true">
          <span
            className="rating-bar-fill"
            style={{ width: `${percent}%`, background: color }}
          />
        </span>
      )}
    </div>
  );
}
