/**
 * Cola de eventos de analitica.
 *
 * Nada de esto corre sin consentimiento: `track` sale antes de encolar si el
 * comensal no acepto. Ver `consent.ts`.
 *
 * Nada se envia de inmediato: los eventos se acumulan y salen en lote cada dos
 * segundos (o al ocultarse la pestaña). En un celular con 4G, veinte requests
 * sueltos mientras el cliente gira un modelo 3D se notan; un request cada dos
 * segundos, no.
 */
import { AnalyticsEvent, type AnalyticsEventInput } from '@men3d/shared';

import { publicApi } from './api.js';
import { puedeMedir } from './consent.js';
import { getSessionId } from './session.js';

const FLUSH_INTERVAL_MS = 2000;
/** Tope del lote: el backend acepta 50 por request. */
const MAX_BATCH = 40;

let queue: AnalyticsEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let currentSlug: string | null = null;
/** Eventos que solo deben contarse una vez por sesion (ver `trackOnce`). */
const seenOnce = new Set<string>();

export function setAnalyticsSlug(slug: string): void {
  if (currentSlug && currentSlug !== slug) flush();
  currentSlug = slug;
}

function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0 || !currentSlug) return;

  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  // La analitica nunca debe romperle la experiencia a nadie: si falla, se
  // descarta el lote en silencio.
  void publicApi.sendEvents(currentSlug, batch).catch(() => undefined);

  if (queue.length > 0) schedule();
}

function schedule(): void {
  timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
}

export interface TrackOptions {
  dishId?: string | null;
  durationMs?: number;
  query?: string;
  value?: number;
  locale?: string;
}

export function track(type: AnalyticsEvent, options: TrackOptions = {}): void {
  // El corte va aca y no en el envio: sin consentimiento el evento no se
  // encola siquiera, asi que no queda nada en memoria que pudiera salir mas
  // tarde si la respuesta cambiara a mitad de la visita.
  if (!puedeMedir()) return;

  queue.push({
    type,
    sessionId: getSessionId(),
    dishId: options.dishId ?? null,
    durationMs: options.durationMs,
    query: options.query,
    value: options.value,
    locale: options.locale as AnalyticsEventInput['locale'],
  });
  // El lote se fuerza si se llena, para no perder eventos de una sesion larga.
  if (queue.length >= MAX_BATCH) flush();
  else schedule();
}

/** Como `track`, pero ignora repeticiones dentro de la misma visita. */
export function trackOnce(
  type: AnalyticsEvent,
  key: string,
  options: TrackOptions = {},
): void {
  const dedupeKey = `${type}:${key}`;
  if (seenOnce.has(dedupeKey)) return;
  seenOnce.add(dedupeKey);
  track(type, options);
}

if (typeof document !== 'undefined') {
  // `visibilitychange` es el unico evento confiable en iOS para despedirse:
  // `beforeunload` no se dispara al cerrar una pestaña desde el selector.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export { AnalyticsEvent, flush as flushAnalytics };
