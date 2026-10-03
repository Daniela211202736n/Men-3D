/**
 * Tus datos: que hay, descargarlo y borrarlo.
 *
 * Escrita para que la entienda alguien sentado a la mesa esperando la comida,
 * no para cumplir un tramite: dice en castellano que se guarda, por que, y que
 * pasa exactamente si toca borrar —incluido lo que NO se borra y el motivo.
 *
 * Que los pedidos se anonimicen en vez de borrarse no es una letra chica: es
 * la unica parte que puede sorprender, asi que se dice antes de confirmar y no
 * despues.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Spinner } from '../../components/ui.js';
import { ApiError, publicApi } from '../../lib/api.js';
import {
  consentimientoActual,
  olvidarRespuesta,
  responder,
  type Consentimiento,
} from '../../lib/consent.js';
import { getGuestId } from '../../lib/session.js';
import { useVenue } from '../../store/venue.js';

type Datos = Awaited<ReturnType<typeof publicApi.privacyData>>;

export function PrivacyPage(): ReactNode {
  const { slug } = useVenue();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrado, setBorrado] = useState<string | null>(null);
  const [consentimiento, setConsentimiento] = useState<Consentimiento>(() =>
    consentimientoActual(),
  );

  const ver = async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await publicApi.privacyData(slug, getGuestId()));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos traer tus datos');
    } finally {
      setCargando(false);
    }
  };

  const descargar = () => {
    if (!datos) return;
    // Se descarga lo que ya esta en pantalla, sin volver al servidor.
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mis-datos-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const borrar = async () => {
    if (
      !window.confirm(
        'Se borran tus opiniones y tus puntos, y tus pedidos quedan sin ningun ' +
          'dato tuyo. Los puntos no se pueden recuperar. ¿Seguimos?',
      )
    ) {
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const r = await publicApi.deletePrivacyData(slug, getGuestId());
      setBorrado(r.mensaje);
      setDatos(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'No pudimos borrar tus datos');
    } finally {
      setCargando(false);
    }
  };

  const cambiarConsentimiento = (nuevo: 'aceptado' | 'rechazado') => {
    responder(nuevo);
    setConsentimiento(nuevo);
  };

  return (
    <div className="stack stack-5" style={{ paddingBottom: 32 }}>
      <header className="stack stack-2">
        <h1>Tus datos</h1>
        <p className="secondary small">
          No tenes cuenta acá. Te identifica un código al azar guardado en tu
          navegador, que desaparece si borras los datos del sitio.
        </p>
      </header>

      <section className="card card-pad stack stack-3">
        <h3 style={{ margin: 0 }}>Medición de uso</h3>
        <p className="small secondary" style={{ margin: 0 }}>
          Sirve para que el restaurante sepa qué platos se miran y cuáles no. No
          son cookies de terceros y no te seguimos fuera de esta carta.
        </p>
        <p className="tiny muted" style={{ margin: 0 }}>
          Estado:{' '}
          <strong>
            {consentimiento === 'aceptado'
              ? 'aceptada'
              : consentimiento === 'rechazado'
                ? 'rechazada — no se registra nada'
                : 'sin responder — no se registra nada'}
          </strong>
        </p>
        <div className="row wrap" style={{ gap: 8 }}>
          {consentimiento !== 'rechazado' && (
            <button
              type="button"
              className="btn grow"
              onClick={() => cambiarConsentimiento('rechazado')}
            >
              No medir
            </button>
          )}
          {consentimiento !== 'aceptado' && (
            <button
              type="button"
              className="btn grow"
              onClick={() => cambiarConsentimiento('aceptado')}
            >
              Permitir
            </button>
          )}
          {consentimiento !== 'sin-responder' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                olvidarRespuesta();
                setConsentimiento('sin-responder');
              }}
            >
              Volver a preguntarme
            </button>
          )}
        </div>
      </section>

      <section className="card card-pad stack stack-3">
        <h3 style={{ margin: 0 }}>Qué se guarda</h3>
        <ul className="stack stack-2 small secondary" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <strong>Tus pedidos</strong>: los platos, el importe y, si los
            dejaste, tu nombre, teléfono o mail para avisarte.
          </li>
          <li>
            <strong>Tus opiniones</strong>, con el nombre que hayas puesto.
          </li>
          <li>
            <strong>Tus puntos</strong>, atados al código de tu navegador.
          </li>
          <li>
            <strong>Qué platos se miran</strong>, si lo permitiste. Esto se
            guarda contra un código de visita que no está vinculado a vos: ni el
            restaurante ni nosotros podemos saber cuáles son tuyos.
          </li>
        </ul>
      </section>

      <section className="card card-pad stack stack-3">
        <h3 style={{ margin: 0 }}>Ver o borrar</h3>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {borrado && (
          <p className="small" role="status">
            {borrado}
          </p>
        )}

        {cargando && <Spinner label="Un momento" />}

        {!cargando && !datos && !borrado && (
          <button type="button" className="btn btn-primary" onClick={() => void ver()}>
            Ver todo lo que hay
          </button>
        )}

        {datos && (
          <>
            <div className="row wrap small" style={{ gap: 12 }}>
              <span>
                <strong>{datos.pedidos.length}</strong> pedido(s)
              </span>
              <span>
                <strong>{datos.opiniones.length}</strong> opinión(es)
              </span>
              <span>
                <strong>{datos.puntos?.saldo ?? 0}</strong> punto(s)
              </span>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              {datos.analitica}
            </p>
            <button type="button" className="btn" onClick={descargar}>
              Descargarlo en un archivo
            </button>
          </>
        )}

        {!borrado && (
          <>
            <p className="tiny muted" style={{ margin: 0 }}>
              Al borrar se van tus opiniones y tus puntos. Tus pedidos quedan sin
              ningún dato tuyo —el restaurante conserva el comprobante de la
              venta, que está obligado a guardar, pero ya no te señala.
            </p>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void borrar()}
              disabled={cargando}
            >
              Borrar mis datos
            </button>
          </>
        )}
      </section>

      {/* Esta pantalla es la que resuelve: ver, descargar y borrar. El texto
          legal va al final, para quien lo quiera leer, y no al principio. */}
      <div className="row tiny muted" style={{ flexWrap: 'wrap', gap: 14 }}>
        <Link to="/legal/privacidad" className="tiny muted">
          Política de privacidad
        </Link>
        <Link to="/legal/terminos-comensal" className="tiny muted">
          Términos para el comensal
        </Link>
      </div>
    </div>
  );
}
