/**
 * Personalizacion de marca.
 *
 * Cada cambio se previsualiza en vivo sobre los tokens de CSS, y el contraste
 * del texto sobre el color elegido se calcula solo: un restaurante con marca
 * amarilla no puede terminar con botones ilegibles.
 */
import { useEffect, useState, type ReactNode } from 'react';

import type { BrandingDto } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { applyBranding, inkFor } from '../../lib/branding.js';
import { useAsync } from '../../lib/useAsync.js';
import { useAuth } from '../../store/auth.js';
import { useToast } from '../../store/toast.js';

const PRESETS: Array<{ name: string; primary: string; accent: string }> = [
  { name: 'Parrilla', primary: '#b5341f', accent: '#eda100' },
  { name: 'Verde', primary: '#1baf7a', accent: '#4a3aa7' },
  { name: 'Clasico', primary: '#2a78d6', accent: '#eb6834' },
  { name: 'Nocturno', primary: '#4a3aa7', accent: '#e87ba4' },
];

export function BrandingPage(): ReactNode {
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(
    (signal) => adminApi.branding(signal),
    [],
  );
  const [form, setForm] = useState<BrandingDto | null>(null);
  const [saving, setSaving] = useState(false);

  const state = form ?? data;

  // Previsualizacion en vivo: se aplican los colores mientras se editan.
  useEffect(() => {
    if (state) applyBranding(state);
  }, [state]);

  // Al salir sin guardar se restauran los colores que estaban persistidos.
  useEffect(() => () => {
    if (data) applyBranding(data);
  }, [data]);

  if (loading && !data) return <Spinner label="Cargando la marca" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!state) return null;

  const update = (patch: Partial<BrandingDto>) => setForm({ ...state, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateBranding(state);
      toast.show('Marca actualizada');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack stack-5" style={{ maxWidth: 620 }}>
      <header className="stack stack-2">
        <h1>Marca</h1>
        <p className="small muted">
          Los colores se aplican a la carta que ve el comensal en /m/{user?.tenantSlug}.
        </p>
      </header>

      <section className="card card-pad stack stack-3">
        <span className="label">Combinaciones listas</span>
        <div className="row wrap" style={{ gap: 8 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="chip"
              onClick={() =>
                update({ primaryColor: preset.primary, accentColor: preset.accent })
              }
            >
              <span
                className="chart-swatch"
                style={{ background: preset.primary }}
                aria-hidden="true"
              />
              <span
                className="chart-swatch"
                style={{ background: preset.accent }}
                aria-hidden="true"
              />
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card card-pad stack stack-3">
        <ColorField
          label="Color principal"
          hint="Botones y acentos de la carta"
          value={state.primaryColor}
          onChange={(primaryColor) => update({ primaryColor })}
        />
        <ColorField
          label="Color secundario"
          hint="Estrellas y detalles"
          value={state.accentColor}
          onChange={(accentColor) => update({ accentColor })}
        />

        <label className="field">
          <span className="label">Modo inicial</span>
          <select
            className="select"
            value={state.colorScheme}
            onChange={(e) =>
              update({ colorScheme: e.target.value as BrandingDto['colorScheme'] })
            }
          >
            <option value="system">Seguir al telefono del comensal</option>
            <option value="light">Siempre claro</option>
            <option value="dark">Siempre oscuro</option>
          </select>
          <span className="tiny muted">
            El comensal siempre puede cambiarlo desde la carta.
          </span>
        </label>

        <label className="field">
          <span className="label">URL del logo</span>
          <input
            className="input"
            value={state.logoUrl ?? ''}
            placeholder="https://..."
            onChange={(e) => update({ logoUrl: e.target.value || null })}
          />
        </label>
        <label className="field">
          <span className="label">Imagen de portada</span>
          <input
            className="input"
            value={state.heroImageUrl ?? ''}
            placeholder="https://..."
            onChange={(e) => update({ heroImageUrl: e.target.value || null })}
          />
        </label>
        <label className="field">
          <span className="label">Fondo de pantalla</span>
          <input
            className="input"
            value={state.backgroundImageUrl ?? ''}
            placeholder="https://..."
            onChange={(e) => update({ backgroundImageUrl: e.target.value || null })}
          />
        </label>
      </section>

      {/* Muestra como queda el texto sobre el color elegido. */}
      <section className="card card-pad stack stack-3">
        <span className="label">Como se va a ver</span>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary">
            Agregar al pedido
          </button>
          <span className="badge badge-3d">3D</span>
          <span className="chip is-active">Vegano</span>
        </div>
        <p className="tiny muted">
          El texto del boton se calcula a{' '}
          {inkFor(state.primaryColor) === '#ffffff' ? 'blanco' : 'negro'} segun el
          contraste de tu color.
        </p>
      </section>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Guardando...' : 'Guardar marca'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setForm(null);
            if (data) applyBranding(data);
          }}
        >
          Descartar cambios
        </button>
      </div>
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="color"
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 52, height: 44, padding: 2, border: 0, background: 'none' }}
        />
        <input
          className="input grow nums"
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <span className="tiny muted">{hint}</span>
    </div>
  );
}
