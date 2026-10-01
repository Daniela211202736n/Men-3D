/**
 * Plan contratado, uso y funcionalidades.
 *
 * Muestra el modelo comercial tal cual se cobra: suscripcion mensual mas el
 * cobro unico de configuracion inicial (carga de carta y modelado 3D).
 */
import { useState, type ReactNode } from 'react';

import { Feature, PLAN_FEATURES, type PlanTier } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useAuth } from '../../store/auth.js';
import { useToast } from '../../store/toast.js';

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
  const { data: abono, reload: recargarAbono } = useAsync(
    (signal) => adminApi.subscription(signal),
    [],
  );

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

      {abono && <AvisoDeCobro abono={abono} onCambio={() => { reload(); recargarAbono(); }} />}

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

/** Lo que devuelve `GET /api/admin/subscription`. */
type Abono = Awaited<ReturnType<typeof adminApi.subscription>>;

/**
 * Estado del abono y el boton para activarlo.
 *
 * Va arriba de todo cuando hay un problema de cobro, porque es lo unico que el
 * dueño tiene que hacer. Y dice con todas las letras que la carta sigue
 * funcionando: el susto de "me apagaron el local" es peor que el impago.
 */
function AvisoDeCobro({
  abono,
  onCambio,
}: {
  abono: Abono;
  onCambio: () => void;
}): ReactNode {
  const toast = useToast();
  const { user } = useAuth();
  const [yendo, setYendo] = useState(false);
  const soyDueño = user?.role === 'OWNER';

  const activar = async () => {
    if (yendo) return;
    setYendo(true);
    try {
      const { initPoint } = await adminApi.startSubscription();
      // A MercadoPago a autorizar el debito. Lo que active el plan va a ser el
      // aviso de la pasarela, no esta vuelta.
      window.location.href = initPoint;
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : 'No pudimos iniciar el cobro',
        'error',
      );
      setYendo(false);
    }
  };

  const darDeBaja = async () => {
    if (
      !window.confirm(
        '¿Dar de baja el abono? La carta y el visor 3D siguen funcionando con el plan gratuito.',
      )
    ) {
      return;
    }
    try {
      const { mensaje } = await adminApi.cancelSubscription();
      toast.show(mensaje);
      onCambio();
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : 'No pudimos dar de baja',
        'error',
      );
    }
  };

  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-AR') : null;

  if (abono.status === 'PAST_DUE') {
    return (
      <section className="card card-pad stack stack-3" style={{ borderColor: 'var(--warning)' }}>
        <h3>No pudimos cobrar el abono</h3>
        <p className="secondary small">
          Suele ser una tarjeta vencida.{' '}
          {abono.graceEndsAt ? (
            <>
              Tenes hasta el <strong>{fecha(abono.graceEndsAt)}</strong> para
              resolverlo.
            </>
          ) : (
            <>Tenes unos dias para resolverlo.</>
          )}{' '}
          Hasta entonces no cambia nada: todo sigue funcionando igual.
        </p>
        <p className="tiny muted">
          Si vence el plazo, el local pasa al plan gratuito. La carta y el visor 3D
          siguen en pie para tus comensales; se apagan los pedidos, las metricas y la
          traduccion. No se borra nada de lo cargado.
        </p>
        {soyDueño && (
          <button type="button" className="btn btn-primary" onClick={() => void activar()} disabled={yendo}>
            {yendo ? 'Abriendo...' : 'Actualizar el medio de pago'}
          </button>
        )}
      </section>
    );
  }

  if (abono.status === 'SUSPENDED') {
    return (
      <section className="card card-pad stack stack-3" style={{ borderColor: 'var(--critical)' }}>
        <h3>Tu local esta en el plan gratuito</h3>
        <p className="secondary small">
          No pudimos cobrar el abono y se vencio el plazo.{' '}
          <strong>Tu carta y el visor 3D siguen funcionando</strong>: tus comensales no
          notan nada. Lo que esta apagado son los pedidos, las metricas y la traduccion.
        </p>
        <p className="tiny muted">No se borro nada. Al cobrar, vuelve todo tal cual.</p>
        {soyDueño && (
          <button type="button" className="btn btn-primary" onClick={() => void activar()} disabled={yendo}>
            {yendo ? 'Abriendo...' : 'Reactivar el abono'}
          </button>
        )}
      </section>
    );
  }

  if (abono.status === 'CANCELED') {
    return (
      <section className="card card-pad stack stack-3">
        <h3>Sin abono</h3>
        <p className="secondary small">
          Estas en el plan gratuito. La carta y el visor 3D funcionan; los pedidos, las
          metricas y la traduccion necesitan un plan pago.
        </p>
        {soyDueño && (
          <button type="button" className="btn btn-primary" onClick={() => void activar()} disabled={yendo}>
            {yendo ? 'Abriendo...' : 'Activar el abono mensual'}
          </button>
        )}
      </section>
    );
  }

  // Al dia. Si todavia se cobra a mano, se ofrece activar el debito.
  const debitoActivo = abono.provider === 'MERCADOPAGO' && abono.status === 'ACTIVE';
  return (
    <section className="card card-pad stack stack-3">
      <div className="row-between wrap" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>Abono mensual</h3>
        <span className={debitoActivo ? 'badge badge-good' : 'badge'}>
          {debitoActivo ? 'debito automatico' : 'cobro manual'}
        </span>
      </div>

      {abono.currentPeriodEnd && (
        <p className="small secondary">
          Proximo cobro: <strong>{fecha(abono.currentPeriodEnd)}</strong>
        </p>
      )}

      {!debitoActivo && (
        <>
          <p className="small secondary">
            Activa el debito automatico y te lo cobramos todos los meses sin que tengas
            que acordarte.
          </p>
          {soyDueño &&
            (abono.pasarelaLista === false ? (
              <p className="tiny muted">
                El cobro automatico todavia no esta configurado en este servidor.
              </p>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void activar()} disabled={yendo}>
                {yendo ? 'Abriendo...' : 'Activar el debito automatico'}
              </button>
            ))}
        </>
      )}

      {debitoActivo && soyDueño && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void darDeBaja()}>
          Dar de baja el abono
        </button>
      )}
    </section>
  );
}
