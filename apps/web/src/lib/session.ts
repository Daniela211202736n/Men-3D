/**
 * Identidad del comensal, sin cuentas ni cookies de terceros.
 *
 *  - `sessionId`: una visita. Agrupa los eventos de analitica.
 *  - `guestId`:   el dispositivo. Sostiene el saldo de puntos entre visitas.
 *
 * Los dos viven en el navegador del cliente y no identifican a una persona:
 * son identificadores opacos que el comensal borra limpiando el sitio.
 */
const GUEST_KEY = 'men3d.guestId';
const SESSION_KEY = 'men3d.sessionId';
/** Una visita se considera terminada tras 30 minutos sin actividad. */
const SESSION_TTL_MS = 30 * 60 * 1000;

function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${hex}`;
}

/** Lectura tolerante: en modo privado el acceso al storage puede lanzar. */
function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* sin persistencia: el id dura lo que la pestaña */
  }
}

let memoryGuestId: string | null = null;

export function getGuestId(): string {
  const stored = read(localStorage, GUEST_KEY);
  if (stored) return stored;
  // Si el storage no esta disponible, se mantiene en memoria para que al menos
  // la sesion actual sea coherente.
  memoryGuestId ??= randomId('g');
  write(localStorage, GUEST_KEY, memoryGuestId);
  return memoryGuestId;
}

interface StoredSession {
  id: string;
  lastSeen: number;
}

let memorySession: StoredSession | null = null;

export function getSessionId(): string {
  const now = Date.now();
  const raw = read(sessionStorage, SESSION_KEY) ?? null;

  let session: StoredSession | null = memorySession;
  if (raw) {
    try {
      session = JSON.parse(raw) as StoredSession;
    } catch {
      session = null;
    }
  }

  if (!session || now - session.lastSeen > SESSION_TTL_MS) {
    session = { id: randomId('s'), lastSeen: now };
  } else {
    session.lastSeen = now;
  }

  memorySession = session;
  write(sessionStorage, SESSION_KEY, JSON.stringify(session));
  return session.id;
}

/** Recuerda la mesa desde la que se escaneo el QR. */
const TABLE_KEY = 'men3d.table';

export function setTable(label: string | null): void {
  if (label) write(sessionStorage, TABLE_KEY, label);
}

export function getTable(): string | null {
  return read(sessionStorage, TABLE_KEY);
}
