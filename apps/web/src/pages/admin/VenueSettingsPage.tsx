/**
 * Datos del local: contacto, ubicacion, redes, impuestos, idiomas y traduccion
 * automatica de la carta.
 */
import { useState, type ReactNode } from 'react';

import { SUPPORTED_LOCALES, type Locale, type VenueDto } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { LOCALE_NAMES } from '../../lib/i18n.js';
import { useAsync } from '../../lib/useAsync.js';
import { useAuth } from '../../store/auth.js';
import { useToast } from '../../store/toast.js';

export function VenueSettingsPage(): ReactNode {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(
    (signal) => adminApi.venue(signal),
    [],
  );
  const [form, setForm] = useState<VenueDto | null>(null);
  const [saving, setSaving] = useState(false);

  const state = form ?? data;
  if (loading && !data) return <Spinner label="Cargando los datos" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!state) return null;

  const update = (patch: Partial<VenueDto>) => setForm({ ...state, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.updateVenue({
        name: state.name,
        description: state.description,
        phone: state.phone,
        whatsapp: state.whatsapp,
        email: state.email,
        addressLine: state.addressLine,
        city: state.city,
        country: state.country,
        latitude: state.latitude,
        longitude: state.longitude,
        googlePlaceId: state.googlePlaceId,
        instagramUrl: state.instagramUrl || null,
        tiktokUrl: state.tiktokUrl || null,
        facebookUrl: state.facebookUrl || null,
        openingHours: state.openingHours,
        taxRateBps: state.taxRateBps,
        defaultLocale: state.defaultLocale,
        enabledLocales: state.enabledLocales,
      });
      toast.show('Datos guardados');
      reload();
      setForm(null);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleLocale = (locale: Locale) => {
    const enabled = state.enabledLocales.includes(locale)
      ? state.enabledLocales.filter((l) => l !== locale)
      : [...state.enabledLocales, locale];
    // El idioma de carga de la carta no se puede desactivar: es el texto origen.
    if (!enabled.includes(state.defaultLocale)) enabled.push(state.defaultLocale);
    update({ enabledLocales: enabled });
  };

  return (
    <div className="stack stack-5" style={{ maxWidth: 680 }}>
      <header className="stack stack-2">
        <h1>Datos del local</h1>
        <p className="small muted">Es lo que ve el comensal en la pestaña "El local".</p>
      </header>

      <section className="card card-pad stack stack-3">
        <h3>Identidad y contacto</h3>
        <Field label="Nombre" value={state.name} onChange={(name) => update({ name })} />
        <label className="field">
          <span className="label">Descripcion</span>
          <textarea
            className="textarea"
            value={state.description ?? ''}
            maxLength={2000}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field
            label="Telefono"
            value={state.phone ?? ''}
            onChange={(phone) => update({ phone })}
          />
          <Field
            label="WhatsApp (con codigo de pais)"
            value={state.whatsapp ?? ''}
            onChange={(whatsapp) => update({ whatsapp })}
          />
        </div>
        <Field
          label="Horarios"
          value={state.openingHours ?? ''}
          onChange={(openingHours) => update({ openingHours })}
        />
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Ubicacion</h3>
        <Field
          label="Direccion"
          value={state.addressLine ?? ''}
          onChange={(addressLine) => update({ addressLine })}
        />
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Ciudad" value={state.city ?? ''} onChange={(city) => update({ city })} />
          <Field
            label="Pais"
            value={state.country ?? ''}
            onChange={(country) => update({ country })}
          />
        </div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field
            label="Latitud"
            value={state.latitude?.toString() ?? ''}
            onChange={(v) => update({ latitude: v === '' ? null : Number(v) })}
          />
          <Field
            label="Longitud"
            value={state.longitude?.toString() ?? ''}
            onChange={(v) => update({ longitude: v === '' ? null : Number(v) })}
          />
        </div>
        <Field
          label="Google Place ID (opcional)"
          value={state.googlePlaceId ?? ''}
          onChange={(googlePlaceId) => update({ googlePlaceId })}
        />
        <p className="tiny muted">
          Las coordenadas se sacan de Google Maps: boton derecho sobre el local →
          "¿Que hay aqui?". Con el Place ID, el boton "Ver en el mapa" abre la ficha
          del negocio.
        </p>
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Redes sociales</h3>
        <Field
          label="Instagram"
          value={state.instagramUrl ?? ''}
          onChange={(instagramUrl) => update({ instagramUrl })}
        />
        <Field
          label="TikTok"
          value={state.tiktokUrl ?? ''}
          onChange={(tiktokUrl) => update({ tiktokUrl })}
        />
        <Field
          label="Facebook"
          value={state.facebookUrl ?? ''}
          onChange={(facebookUrl) => update({ facebookUrl })}
        />
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Facturacion e idiomas</h3>
        <label className="field">
          <span className="label">IVA aplicado al pedido (%)</span>
          <input
            className="input nums"
            inputMode="decimal"
            value={(state.taxRateBps / 100).toString()}
            onChange={(e) =>
              update({ taxRateBps: Math.round(Number(e.target.value || 0) * 100) })
            }
          />
        </label>

        <div className="field">
          <span className="label">Idiomas ofrecidos al comensal</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                className="chip"
                aria-pressed={state.enabledLocales.includes(locale)}
                disabled={locale === state.defaultLocale}
                onClick={() => toggleLocale(locale)}
              >
                {LOCALE_NAMES[locale]}
                {locale === state.defaultLocale ? ' (origen)' : ''}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Guardando...' : 'Guardar datos'}
        </button>
        <button type="button" className="btn" onClick={() => setForm(null)}>
          Descartar cambios
        </button>
      </div>

      {can('AUTO_TRANSLATION') && <TranslationPanel venue={state} />}
    </div>
  );
}

/** Traduccion automatica de la carta a cada idioma habilitado. */
function TranslationPanel({ venue }: { venue: VenueDto }): ReactNode {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const targets = venue.enabledLocales.filter((l) => l !== venue.defaultLocale);

  const translate = async (locale: Locale, overwrite: boolean) => {
    setBusy(locale);
    try {
      const result = await adminApi.translate(locale, overwrite);
      toast.show(
        result.translated === 0
          ? 'No habia nada nuevo por traducir'
          : `${result.translated} plato(s) traducido(s) al ${LOCALE_NAMES[locale]}`,
      );
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : 'No se pudo traducir',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card card-pad stack stack-3">
      <div className="stack" style={{ gap: 2 }}>
        <h3>Traduccion automatica</h3>
        <p className="small muted">
          Traduce nombres y descripciones desde {LOCALE_NAMES[venue.defaultLocale]}. Los
          nombres de platos tradicionales no se traducen. Lo que corrijas a mano no se
          vuelve a sobreescribir.
        </p>
      </div>

      {targets.length === 0 ? (
        <p className="small muted">
          Habilita otro idioma arriba para poder traducir la carta.
        </p>
      ) : (
        <div className="stack stack-2">
          {targets.map((locale) => (
            <div key={locale} className="row-between">
              <span className="small bold">{LOCALE_NAMES[locale]}</span>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== null}
                  onClick={() => void translate(locale, false)}
                >
                  {busy === locale ? 'Traduciendo...' : 'Traducir lo que falta'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() => void translate(locale, true)}
                >
                  Rehacer todo
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="field grow">
      <span className="label">{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
