/**
 * Cliente HTTP tipado contra los DTO de `@men3d/shared`.
 *
 * Un cambio de contrato en la API rompe el `tsc` del frontend, no la pantalla
 * del comensal.
 */
import type {
  AnalyticsDashboardDto,
  AnalyticsEventInput,
  ApiErrorDto,
  AuthResponseDto,
  BrandingDto,
  CategoryDto,
  DishDto,
  Feature,
  LoyaltyAccountDto,
  MenuDto,
  OrderDto,
  PairingDto,
  PlanTier,
  ReviewDto,
  VenueDto,
} from '@men3d/shared';

/** En desarrollo Vite proxea /api; en produccion se sirve del mismo origen. */
const BASE = import.meta.env.VITE_API_URL ?? '';

const TOKEN_KEY = 'men3d.admin.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Modo privado de Safari puede denegar el acceso a localStorage.
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sin persistencia: la sesion dura lo que la pestaña */
  }
}

/** Error con el codigo que devolvio la API, para poder discriminarlo arriba. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Agrega el token del backoffice. */
  auth?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      url.searchParams.set(key, value.join(','));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'No pudimos conectarnos. Revisa tu conexion.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const err = (payload as ApiErrorDto | null)?.error;
    // Un 401 en el backoffice significa sesion vencida: se limpia el token para
    // que el guardia de ruta mande al login en vez de reintentar en loop. No se
    // toca si la peticion fue cancelada: ahi el 401 no es la ultima palabra.
    if (response.status === 401 && options.auth && !options.signal?.aborted) {
      setToken(null);
    }
    throw new ApiError(
      response.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Error ${response.status}`,
      err?.details,
    );
  }

  return payload as T;
}

export interface MenuResponse extends MenuDto {
  matchCount: number;
}

export interface MenuFilters {
  q?: string;
  categoryId?: string;
  diets?: string[];
  excludeAllergens?: string[];
  only3d?: boolean;
  locale?: string;
  sessionId?: string;
  /** Firma de indice: permite pasar el objeto tal cual como query string. */
  [key: string]: string | number | boolean | string[] | undefined;
}

/* ------------------------------------------------------------------ publico */

export const publicApi = {
  venue: (slug: string, signal?: AbortSignal) =>
    request<VenueDto>(`/api/public/${slug}/venue`, { signal }),

  menu: (slug: string, filters: MenuFilters = {}, signal?: AbortSignal) =>
    request<MenuResponse>(`/api/public/${slug}/menu`, { query: filters, signal }),

  dish: (slug: string, dishId: string, locale?: string, signal?: AbortSignal) =>
    request<DishDto>(`/api/public/${slug}/dishes/${dishId}`, {
      query: { locale },
      signal,
    }),

  pairings: (slug: string, dishId: string, locale?: string, signal?: AbortSignal) =>
    request<PairingDto[]>(`/api/public/${slug}/dishes/${dishId}/pairings`, {
      query: { locale, limit: 3 },
      signal,
    }),

  reviews: (slug: string, dishId?: string, signal?: AbortSignal) =>
    request<ReviewDto[]>(`/api/public/${slug}/reviews`, {
      query: { dishId },
      signal,
    }),

  createReview: (
    slug: string,
    body: { dishId?: string | null; rating: number; comment?: string; authorName?: string },
  ) => request<ReviewDto>(`/api/public/${slug}/reviews`, { method: 'POST', body }),

  sendEvents: (slug: string, events: AnalyticsEventInput[]) =>
    request<{ accepted: number }>(`/api/public/${slug}/events`, {
      method: 'POST',
      body: { events },
    }),

  registerScan: (slug: string, token: string) =>
    request<void>(`/api/public/${slug}/scan`, { method: 'POST', body: { token } }),

  loyalty: (slug: string, guestId: string, signal?: AbortSignal) =>
    request<LoyaltyAccountDto>(`/api/public/${slug}/loyalty`, {
      query: { guestId },
      signal,
    }),

  createOrder: (
    slug: string,
    body: {
      items: Array<{ dishId: string; quantity: number; notes?: string }>;
      serviceMode?: string;
      tableLabel?: string | null;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      notes?: string;
      redeemPoints?: number;
      guestId?: string;
    },
  ) =>
    request<{ order: OrderDto; checkoutUrl: string | null; clientSecret: string | null }>(
      `/api/public/${slug}/orders`,
      { method: 'POST', body },
    ),

  order: (slug: string, code: string, signal?: AbortSignal) =>
    request<OrderDto>(`/api/public/${slug}/orders/${code}`, { signal }),
};

/* --------------------------------------------------------------- backoffice */

export interface PlanInfo {
  tier: PlanTier;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  monthlyCents: number;
  setupFeeCents: number;
  setupFeePaid: boolean;
  features: Feature[];
  usage: {
    dishes: number;
    maxDishes: number;
    models3d: number;
    max3dModels: number;
  };
}

export interface QrTarget {
  tableLabel: string | null;
  token: string;
  url: string;
}

export interface KdsBoard {
  servedWindowHours: number;
  columns: Array<{ status: string; orders: OrderDto[] }>;
}

export const adminApi = {
  login: (email: string, password: string) =>
    request<AuthResponseDto>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  register: (body: {
    restaurantName: string;
    slug: string;
    ownerName: string;
    email: string;
    password: string;
  }) => request<AuthResponseDto>('/api/auth/register', { method: 'POST', body }),

  me: (signal?: AbortSignal) =>
    request<{ user: AuthResponseDto['user']; plan: AuthResponseDto['plan'] }>(
      '/api/auth/me',
      { auth: true, signal },
    ),

  // --- carta ---------------------------------------------------------------
  categories: (signal?: AbortSignal) =>
    request<CategoryDto[]>('/api/admin/categories', { auth: true, signal }),

  createCategory: (body: { name: string; description?: string }) =>
    request<unknown>('/api/admin/categories', { method: 'POST', body, auth: true }),

  updateCategory: (id: string, body: Record<string, unknown>) =>
    request<unknown>(`/api/admin/categories/${id}`, {
      method: 'PATCH',
      body,
      auth: true,
    }),

  deleteCategory: (id: string) =>
    request<void>(`/api/admin/categories/${id}`, { method: 'DELETE', auth: true }),

  reorderCategories: (ids: string[]) =>
    request<{ updated: number }>('/api/admin/categories/order', {
      method: 'PUT',
      body: { ids },
      auth: true,
    }),

  dishes: (includeArchived = false, signal?: AbortSignal) =>
    request<DishDto[]>('/api/admin/dishes', {
      query: { includeArchived },
      auth: true,
      signal,
    }),

  createDish: (body: Record<string, unknown>) =>
    request<DishDto>('/api/admin/dishes', { method: 'POST', body, auth: true }),

  updateDish: (id: string, body: Record<string, unknown>) =>
    request<DishDto>(`/api/admin/dishes/${id}`, { method: 'PATCH', body, auth: true }),

  updatePrice: (id: string, priceCents: number) =>
    request<{ id: string; priceCents: number }>(`/api/admin/dishes/${id}/price`, {
      method: 'PATCH',
      body: { priceCents },
      auth: true,
    }),

  updateAvailability: (id: string, isAvailable: boolean) =>
    request<{ id: string; isAvailable: boolean }>(
      `/api/admin/dishes/${id}/availability`,
      { method: 'PATCH', body: { isAvailable }, auth: true },
    ),

  reorderDishes: (ids: string[]) =>
    request<{ updated: number }>('/api/admin/dishes/order', {
      method: 'PUT',
      body: { ids },
      auth: true,
    }),

  archiveDish: (id: string) =>
    request<{ id: string; archived: boolean }>(`/api/admin/dishes/${id}`, {
      method: 'DELETE',
      auth: true,
    }),

  restoreDish: (id: string) =>
    request<{ id: string; archived: boolean }>(`/api/admin/dishes/${id}/restore`, {
      method: 'POST',
      auth: true,
    }),

  // --- local y marca -------------------------------------------------------
  venue: (signal?: AbortSignal) =>
    request<VenueDto>('/api/admin/venue', { auth: true, signal }),

  updateVenue: (body: Record<string, unknown>) =>
    request<VenueDto>('/api/admin/venue', { method: 'PATCH', body, auth: true }),

  branding: (signal?: AbortSignal) =>
    request<BrandingDto>('/api/admin/branding', { auth: true, signal }),

  updateBranding: (body: Partial<BrandingDto>) =>
    request<BrandingDto>('/api/admin/branding', {
      method: 'PATCH',
      body,
      auth: true,
    }),

  plan: (signal?: AbortSignal) =>
    request<PlanInfo>('/api/admin/plan', { auth: true, signal }),

  // --- operacion -----------------------------------------------------------
  kdsBoard: (signal?: AbortSignal) =>
    request<KdsBoard>('/api/admin/kds/board', { auth: true, signal }),

  /** Ticket de 60 s para abrir el stream SSE (EventSource no acepta headers). */
  kdsTicket: () =>
    request<{ ticket: string; expiresInSeconds: number }>('/api/admin/kds/ticket', {
      method: 'POST',
      auth: true,
    }),

  updateOrderStatus: (id: string, status: string) =>
    request<OrderDto>(`/api/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: { status },
      auth: true,
    }),

  adminReviews: (status?: string, signal?: AbortSignal) =>
    request<ReviewDto[]>('/api/admin/reviews', {
      query: { status },
      auth: true,
      signal,
    }),

  moderateReview: (id: string, body: { status: 'PUBLISHED' | 'HIDDEN'; reply?: string | null }) =>
    request<ReviewDto>(`/api/admin/reviews/${id}`, {
      method: 'PATCH',
      body,
      auth: true,
    }),

  // --- metricas, QR, traduccion -------------------------------------------
  analytics: (days: number, signal?: AbortSignal) =>
    request<AnalyticsDashboardDto>('/api/admin/analytics', {
      query: { days },
      auth: true,
      signal,
    }),

  qrStats: (signal?: AbortSignal) =>
    request<Array<{ tableLabel: string | null; token: string; scans: number; lastScanAt: string | null }>>(
      '/api/admin/analytics/qr',
      { auth: true, signal },
    ),

  qrCodes: (tables: string[], signal?: AbortSignal) =>
    request<QrTarget[]>('/api/admin/qr', {
      query: { tables },
      auth: true,
      signal,
    }),

  share: (signal?: AbortSignal) =>
    request<{ menuUrl: string; whatsapp: string; email: string; shareText: string }>(
      '/api/admin/share',
      { auth: true, signal },
    ),

  translate: (targetLocale: string, overwrite = false) =>
    request<{ translated: number; skipped: number }>('/api/admin/translations', {
      method: 'POST',
      body: { targetLocale, overwrite },
      auth: true,
    }),
};

/**
 * Descarga del PDF de QR. Va por `fetch` en vez de un `<a download>` porque la
 * ruta necesita el header de autorizacion.
 */
export async function downloadQrPdf(
  tables: string[],
  perPage: number,
): Promise<void> {
  const token = getToken();
  const url = buildUrl('/api/admin/qr/download', {
    tables,
    format: 'pdf',
    perPage,
  });
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'No se pudo generar el PDF');
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = 'qr-men3d.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  // Sin revoke, el blob queda en memoria hasta recargar la pagina.
  URL.revokeObjectURL(href);
}

/** Sube un modelo 3D o una imagen y devuelve su URL servible. */
export async function uploadAsset(file: File): Promise<{ url: string; bytes: number }> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(buildUrl('/upload'), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const payload = (await response.json()) as
    | { url: string; bytes: number }
    | ApiErrorDto;
  if (!response.ok) {
    const err = (payload as ApiErrorDto).error;
    throw new ApiError(response.status, err?.code ?? 'UPLOAD_FAILED', err?.message ?? 'Fallo la subida');
  }
  return payload as { url: string; bytes: number };
}
