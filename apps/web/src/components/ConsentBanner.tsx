/**
 * Aviso de medicion de uso.
 *
 * Dos decisiones que lo separan del cartel de cookies habitual:
 *
 *  - **Las dos respuestas pesan lo mismo.** Nada de un "Aceptar" grande en
 *    color y un "Preferencias" gris que lleva a otra pantalla. Si rechazar
 *    cuesta mas que aceptar, el consentimiento no es libre, y ademas es
 *    maltratar a alguien que esta por pedir la cena.
 *  - **No bloquea nada.** Es una barra abajo, no un muro: el comensal escaneo
 *    un QR para ver que hay de comer, no para contestar un formulario. Y va
 *    apilada sobre la barra del pedido, no encima: un aviso que le roba el
 *    clic al boton de pedir cuesta plata y enoja a todos.
 *    Mientras no responde, no se mide nada —el silencio no es un si— asi que
 *    no hay apuro por arrancarle una respuesta.
 *
 * Esto cubre solo la medicion de uso. El carrito, el pedido y el idioma no se
 * preguntan: son el servicio que vino a usar, y sin ellos no puede pedir.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { consentimientoActual, responder } from '../lib/consent.js';

export function ConsentBanner({ slug }: { slug: string }): ReactNode {
  const [estado, setEstado] = useState(() => consentimientoActual());
  const [montado, setMontado] = useState(false);

  // Se espera un instante antes de aparecer: que lo primero que vea el
  // comensal sea la carta, no un cartel.
  useEffect(() => {
    const reloj = setTimeout(() => setMontado(true), 900);
    return () => clearTimeout(reloj);
  }, []);

  if (estado !== 'sin-responder' || !montado) return null;

  const elegir = (respuesta: 'aceptado' | 'rechazado') => {
    responder(respuesta);
    setEstado(respuesta);
  };

  return (
    <div
      className="card card-pad stack stack-3"
      role="region"
      aria-label="Medicion de uso"
      // `sticky` y no `fixed`: con `fixed` el aviso se dibujaba ENCIMA de la
      // barra del pedido y le robaba los clics —el comensal veia el boton de
      // pedir y no podia tocarlo—. Apilado en el flujo, los dos conviven sin
      // pelearse por el z-index y sin que haya que calcular alturas.
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 30,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        maxWidth: 560,
        margin: '0 auto 8px',
      }}
    >
      <p className="small" style={{ margin: 0 }}>
        ¿Nos dejas medir que platos se miran? Le sirve al restaurante para saber
        que mostrar. <strong>No son cookies de terceros</strong> y no te
        seguimos fuera de esta carta.
      </p>

      {/* Dos columnas iguales, no `flex-grow`: grow reparte el espacio sobrante
          a partir del ancho del texto, asi que "Esta bien" quedaba mas angosto
          que "No, gracias" y los botones dejaban de pesar lo mismo. Con la
          grilla miden igual siempre, diga lo que diga el texto o el idioma. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" className="btn" onClick={() => elegir('rechazado')}>
          No, gracias
        </button>
        <button type="button" className="btn" onClick={() => elegir('aceptado')}>
          Esta bien
        </button>
      </div>

      {/* Dos destinos distintos a proposito: el primero son SUS datos, con
          botones para verlos y borrarlos; el segundo es el texto legal. Quien
          esta por pedir la cena quiere el primero. */}
      <span className="row tiny muted" style={{ justifyContent: 'center', gap: 12 }}>
        <Link to={`/m/${slug}/privacidad`} className="tiny muted">
          Que se guarda exactamente
        </Link>
        <Link to="/legal/privacidad" className="tiny muted">
          Politica de privacidad
        </Link>
      </span>
    </div>
  );
}
