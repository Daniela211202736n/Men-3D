/**
 * Vocabulario de dominio compartido entre API y PWA.
 *
 * Se declaran como objetos `as const` + union types en vez de `enum` de
 * TypeScript para que los valores viajen tal cual por JSON y para que el
 * esquema de Prisma pueda guardarlos como `String` (portable entre SQLite y
 * PostgreSQL, ver docs/DATABASE.md).
 */

export const UserRole = {
  /** Dueño del restaurante: acceso total al tenant, incluida facturacion. */
  OWNER: 'OWNER',
  /** Administra carta, precios, branding y reseñas. */
  ADMIN: 'ADMIN',
  /** Solo opera el KDS / pedidos del turno. */
  STAFF: 'STAFF',
  /** Soporte de la plataforma (cross-tenant, solo lectura). */
  SUPPORT: 'SUPPORT',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const PlanTier = {
  FREE: 'FREE',
  STARTER: 'STARTER',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;
export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
} as const;
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** Funcionalidades que el plan habilita (feature gating del SaaS). */
export const Feature = {
  AR_VIEWER: 'AR_VIEWER',
  ONLINE_ORDERING: 'ONLINE_ORDERING',
  PAYMENTS: 'PAYMENTS',
  AI_PAIRINGS: 'AI_PAIRINGS',
  AUTO_TRANSLATION: 'AUTO_TRANSLATION',
  LOYALTY: 'LOYALTY',
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',
  CUSTOM_BRANDING: 'CUSTOM_BRANDING',
  /**
   * Generar el modelo 3D de un plato a partir de una foto.
   *
   * No esta en FREE a proposito, y no es por mezquindad: cada plato generado
   * consume creditos de un proveedor externo que se pagan de verdad. Una cuenta
   * gratis con esto habilitado es una cuenta gratis que nos cobra.
   */
  PHOTO_TO_3D: 'PHOTO_TO_3D',
} as const;
export type Feature = (typeof Feature)[keyof typeof Feature];

export const PLAN_FEATURES: Record<PlanTier, readonly Feature[]> = {
  FREE: ['AR_VIEWER'],
  STARTER: ['AR_VIEWER', 'CUSTOM_BRANDING', 'AUTO_TRANSLATION', 'PHOTO_TO_3D'],
  PRO: [
    'AR_VIEWER',
    'CUSTOM_BRANDING',
    'AUTO_TRANSLATION',
    'ONLINE_ORDERING',
    'PAYMENTS',
    'AI_PAIRINGS',
    'LOYALTY',
    'ADVANCED_ANALYTICS',
    'PHOTO_TO_3D',
  ],
  ENTERPRISE: [
    'AR_VIEWER',
    'CUSTOM_BRANDING',
    'AUTO_TRANSLATION',
    'ONLINE_ORDERING',
    'PAYMENTS',
    'AI_PAIRINGS',
    'LOYALTY',
    'ADVANCED_ANALYTICS',
    'PHOTO_TO_3D',
  ],
} as const;

/** Ciclo de vida de un pedido; el KDS consume estas transiciones. */
export const OrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  /** Aceptado en cocina. */
  IN_KITCHEN: 'IN_KITCHEN',
  READY: 'READY',
  SERVED: 'SERVED',
  CANCELED: 'CANCELED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Orden en que el KDS muestra las columnas del tablero. */
export const KDS_COLUMNS: readonly OrderStatus[] = [
  'PAID',
  'IN_KITCHEN',
  'READY',
  'SERVED',
];

export const PaymentStatus = {
  REQUIRES_PAYMENT: 'REQUIRES_PAYMENT',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ServiceMode = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  DELIVERY: 'DELIVERY',
} as const;
export type ServiceMode = (typeof ServiceMode)[keyof typeof ServiceMode];

/**
 * Eventos de comportamiento. `DISH_VIEW_3D` / `DISH_ROTATE` / `AR_LAUNCH` son
 * los que permiten comparar "interes visual" contra ventas reales.
 */
export const AnalyticsEvent = {
  MENU_OPEN: 'MENU_OPEN',
  SEARCH: 'SEARCH',
  DISH_IMPRESSION: 'DISH_IMPRESSION',
  DISH_OPEN: 'DISH_OPEN',
  DISH_VIEW_3D: 'DISH_VIEW_3D',
  DISH_ROTATE: 'DISH_ROTATE',
  AR_LAUNCH: 'AR_LAUNCH',
  ADD_TO_CART: 'ADD_TO_CART',
  CHECKOUT_START: 'CHECKOUT_START',
  PURCHASE: 'PURCHASE',
  REVIEW_SUBMIT: 'REVIEW_SUBMIT',
  SHARE: 'SHARE',
} as const;
export type AnalyticsEvent = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent];

/**
 * Que se esta probando en un experimento de carta.
 *
 * Solo dos, y a proposito: son los dos campos que mueven la decision del
 * comensal y que se pueden cambiar sin tocar la cocina. Agregar un tercero
 * (la foto, el modelo 3D) es agregar un caso a `aplicarVariante` y nada mas,
 * pero cada campo nuevo multiplica las combinaciones a probar.
 */
export const ExperimentField = {
  DESCRIPTION: 'DESCRIPTION',
  PRICE: 'PRICE',
} as const;
export type ExperimentField = (typeof ExperimentField)[keyof typeof ExperimentField];

/**
 * La variante que le toco a un dispositivo.
 *
 * `A` es siempre lo que dice el plato en la base: el experimento no duplica el
 * valor de control, asi que si el restaurante cambia el precio durante la
 * prueba, A lo sigue. `B` es el valor alternativo.
 */
export const Variant = { A: 'A', B: 'B' } as const;
export type Variant = (typeof Variant)[keyof typeof Variant];

/** Alergenos segun Reglamento UE 1169/2011 (los 14 de declaracion obligatoria). */
export const Allergen = {
  GLUTEN: 'GLUTEN',
  CRUSTACEANS: 'CRUSTACEANS',
  EGGS: 'EGGS',
  FISH: 'FISH',
  PEANUTS: 'PEANUTS',
  SOY: 'SOY',
  MILK: 'MILK',
  NUTS: 'NUTS',
  CELERY: 'CELERY',
  MUSTARD: 'MUSTARD',
  SESAME: 'SESAME',
  SULPHITES: 'SULPHITES',
  LUPIN: 'LUPIN',
  MOLLUSCS: 'MOLLUSCS',
} as const;
export type Allergen = (typeof Allergen)[keyof typeof Allergen];

export const DietTag = {
  VEGETARIAN: 'VEGETARIAN',
  VEGAN: 'VEGAN',
  GLUTEN_FREE: 'GLUTEN_FREE',
  LACTOSE_FREE: 'LACTOSE_FREE',
  KETO: 'KETO',
  HALAL: 'HALAL',
  KOSHER: 'KOSHER',
  SPICY: 'SPICY',
} as const;
export type DietTag = (typeof DietTag)[keyof typeof DietTag];

/** Idiomas con traduccion automatica soportada. */
export const SUPPORTED_LOCALES = ['es', 'en', 'pt', 'fr', 'it', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Motivo por el que el recomendador sugiere un plato (se muestra al cliente). */
export const PairingReason = {
  CURATED: 'CURATED',
  SAME_CATEGORY: 'SAME_CATEGORY',
  FREQUENTLY_TOGETHER: 'FREQUENTLY_TOGETHER',
  COMPLEMENTARY_COURSE: 'COMPLEMENTARY_COURSE',
  DIET_MATCH: 'DIET_MATCH',
} as const;
export type PairingReason = (typeof PairingReason)[keyof typeof PairingReason];

export const LoyaltyReason = {
  DISH_VIEW: 'DISH_VIEW',
  REVIEW: 'REVIEW',
  ORDER: 'ORDER',
  REDEMPTION: 'REDEMPTION',
  MANUAL: 'MANUAL',
} as const;
export type LoyaltyReason = (typeof LoyaltyReason)[keyof typeof LoyaltyReason];

/** Reglas de acumulacion por defecto (configurables por tenant). */
export const LOYALTY_POINTS = {
  /** Una sola vez por plato y por sesion, para que no se pueda farmear. */
  DISH_VIEW: 1,
  REVIEW: 20,
  /** Puntos por unidad monetaria gastada. */
  PER_CURRENCY_UNIT: 1,
  /** Valor de canje: 100 puntos = 1 unidad monetaria de descuento. */
  POINTS_PER_CURRENCY_UNIT: 100,
} as const;
