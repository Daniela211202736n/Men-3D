/**
 * Formas de respuesta de la API. La PWA tipa `fetch` contra estos DTO, asi que
 * cualquier cambio de contrato rompe el `tsc` del frontend en vez de romper en
 * produccion.
 */
import type {
  Allergen,
  DietTag,
  Feature,
  Locale,
  LoyaltyReason,
  OrderStatus,
  PairingReason,
  PaymentStatus,
  PlanTier,
  ServiceMode,
  UserRole,
} from './enums.js';

export interface BrandingDto {
  logoUrl: string | null;
  faviconUrl: string | null;
  heroImageUrl: string | null;
  backgroundImageUrl: string | null;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  fontFamily: string;
  colorScheme: 'light' | 'dark' | 'system';
}

export interface VenueDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  facebookUrl: string | null;
  openingHours: string | null;
  currency: string;
  defaultLocale: Locale;
  enabledLocales: Locale[];
  taxRateBps: number;
  serviceModes: ServiceMode[];
  branding: BrandingDto;
  /** Promedio y volumen de reseñas del local. */
  rating: RatingSummaryDto;
  /** Funcionalidades habilitadas por el plan contratado. */
  features: Feature[];
}

export interface RatingSummaryDto {
  average: number;
  count: number;
  /** Cantidad de reseñas por estrella, de 1 a 5. */
  histogram: [number, number, number, number, number];
}

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  position: number;
  dishCount: number;
}

export interface DishDto {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  description: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  currency: string;
  imageUrl: string | null;
  modelGlbUrl: string | null;
  modelUsdzUrl: string | null;
  /** `true` cuando hay GLB: habilita el boton "Ver en 3D / RA". */
  has3d: boolean;
  portionGrams: number | null;
  calories: number | null;
  prepMinutes: number | null;
  isAvailable: boolean;
  isFeatured: boolean;
  position: number;
  allergens: Allergen[];
  dietTags: DietTag[];
  ingredients: string[];
  rating: RatingSummaryDto;
  /** Idioma en que vienen `name` y `description`. */
  locale: Locale;
  /** `true` si el texto proviene de traduccion automatica. */
  translated: boolean;
}

export interface MenuDto {
  venue: VenueDto;
  categories: CategoryDto[];
  dishes: DishDto[];
  locale: Locale;
}

export interface ReviewDto {
  id: string;
  dishId: string | null;
  dishName: string | null;
  rating: number;
  comment: string | null;
  authorName: string;
  reply: string | null;
  status: 'PUBLISHED' | 'HIDDEN' | 'PENDING';
  createdAt: string;
}

export interface PairingDto {
  dish: DishDto;
  reason: PairingReason;
  /** 0..1 — cuanta confianza tiene el recomendador. */
  score: number;
  /** Copy listo para mostrar ("Marida con la contundencia de la milanesa"). */
  blurb: string | null;
}

export interface OrderItemDto {
  id: string;
  dishId: string;
  dishName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  notes: string | null;
}

export interface OrderDto {
  id: string;
  code: string;
  status: OrderStatus;
  serviceMode: ServiceMode;
  tableLabel: string | null;
  items: OrderItemDto[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  currency: string;
  customerName: string | null;
  notes: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  payment: PaymentDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDto {
  id: string;
  provider: string;
  status: PaymentStatus;
  amountCents: number;
  /** URL de la pasarela cuando el cobro es redirigido (Stripe/MercadoPago). */
  checkoutUrl: string | null;
  /** Secreto de cliente para pasarelas embebidas. */
  clientSecret: string | null;
}

export interface LoyaltyAccountDto {
  guestId: string;
  balance: number;
  lifetimePoints: number;
  /** Equivalencia en dinero del saldo actual. */
  redeemableCents: number;
  currency: string;
  history: Array<{
    id: string;
    points: number;
    reason: LoyaltyReason;
    createdAt: string;
  }>;
}

export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  tenantSlug: string;
}

/** Integrante del equipo del restaurante, como lo ve el backoffice. */
export interface TeamUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /** `true` si es la cuenta con la que se esta navegando. */
  isSelf: boolean;
}

export interface AuthResponseDto {
  token: string;
  user: AuthUserDto;
  plan: { tier: PlanTier; features: Feature[] };
}

/* ----------------------------------------------------------- analiticas */

export interface AnalyticsTotalsDto {
  menuOpens: number;
  uniqueSessions: number;
  views3d: number;
  arLaunches: number;
  addToCarts: number;
  orders: number;
  revenueCents: number;
  /** % de sesiones que terminan en pedido. */
  conversionRate: number;
  /** % de aperturas de plato que llegan al visor 3D. */
  view3dRate: number;
}

/** Fila del informe "interes visual vs ventas reales". */
export interface DishPerformanceRowDto {
  dishId: string;
  dishName: string;
  views3d: number;
  rotations: number;
  arLaunches: number;
  addToCarts: number;
  unitsSold: number;
  revenueCents: number;
  /** unitsSold / views3d — delata el plato que gusta mirar y nadie pide. */
  lookToBookRate: number;
  avgViewSeconds: number;
}

export interface TimeseriesPointDto {
  /** Fecha ISO (YYYY-MM-DD). */
  date: string;
  views3d: number;
  orders: number;
  revenueCents: number;
}

export interface FunnelStageDto {
  stage: 'MENU_OPEN' | 'DISH_OPEN' | 'DISH_VIEW_3D' | 'ADD_TO_CART' | 'PURCHASE';
  sessions: number;
  /** % respecto de la primera etapa. */
  rateFromTop: number;
}

export interface SearchTermRowDto {
  term: string;
  searches: number;
  /** Busquedas que no devolvieron ningun plato: hueco de carta o de sinonimos. */
  zeroResults: number;
}

export interface AnalyticsDashboardDto {
  rangeDays: number;
  currency: string;
  totals: AnalyticsTotalsDto;
  timeseries: TimeseriesPointDto[];
  topDishes: DishPerformanceRowDto[];
  funnel: FunnelStageDto[];
  topSearches: SearchTermRowDto[];
}

/* --------------------------------------------------------------- errores */

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    /** Errores de validacion campo por campo. */
    details?: Array<{ path: string; message: string }>;
  };
}
