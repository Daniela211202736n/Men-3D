/**
 * Consentimiento de analitica.
 *
 * La regla es una sola: **si el comensal dice que no, no se registra nada.**
 * Un aviso que informa y mide igual no es un aviso, es un cartel; y es
 * exactamente lo que vuelve ilegal a la mayoria de las implementaciones.
 *
 * Lo que NO pasa por aca: el carrito, el pedido y el idioma elegido. No son
 * analitica sino el funcionamiento del servicio que el comensal vino a usar
 * —sin ellos no puede pedir— asi que no se piden ni se pueden rechazar. La
 * distincion importa: meter todo bajo el mismo "aceptar" es lo que hace que la
 * gente acepte sin leer.
 *
 * La decision vive en el navegador del comensal. No se manda al servidor: no
 * hay cuenta a la que atarla, y guardar "esta persona dijo que no" seria
 * guardar justo lo que dijo que no quiere.
 */
const CLAVE = 'men3d.consent.analytics';

export type Consentimiento = 'aceptado' | 'rechazado' | 'sin-responder';

function leer(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    // Modo privado o almacenamiento bloqueado.
    return null;
  }
}

export function consentimientoActual(): Consentimiento {
  const valor = leer();
  if (valor === 'aceptado' || valor === 'rechazado') return valor;
  return 'sin-responder';
}

/** Mientras no responda, no se mide: el silencio no es un si. */
export function puedeMedir(): boolean {
  return consentimientoActual() === 'aceptado';
}

type Oyente = (estado: Consentimiento) => void;
const oyentes = new Set<Oyente>();

export function responder(estado: 'aceptado' | 'rechazado'): void {
  try {
    localStorage.setItem(CLAVE, estado);
  } catch {
    /* sin almacenamiento: la respuesta dura lo que la pestaña */
  }
  for (const oyente of oyentes) oyente(estado);
}

export function alCambiarConsentimiento(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/**
 * Olvida la respuesta, para poder cambiarla desde la pantalla de privacidad.
 * Vuelve a `sin-responder`, que no mide.
 */
export function olvidarRespuesta(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* nada que olvidar */
  }
  for (const oyente of oyentes) oyente('sin-responder');
}
