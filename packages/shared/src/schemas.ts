/**
 * Esquemas de validacion compartidos (zod).
 *
 * La API los usa para validar el body de cada request; la PWA los reutiliza
 * para validar formularios antes de enviarlos, de modo que las reglas viven en
 * un solo lugar.
 */
import { z } from 'zod';

import {
  Allergen,
  AnalyticsEvent,
  DietTag,
  OrderStatus,
  ServiceMode,
  SUPPORTED_LOCALES,
  UserRole,
} from './enums.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const localeSchema = z.enum(SUPPORTED_LOCALES);
export const allergenSchema = z.enum(enumValues(Allergen));
export const dietTagSchema = z.enum(enumValues(DietTag));
export const orderStatusSchema = z.enum(enumValues(OrderStatus));
export const serviceModeSchema = z.enum(enumValues(ServiceMode));
export const userRoleSchema = z.enum(enumValues(UserRole));
export const analyticsEventSchema = z.enum(enumValues(AnalyticsEvent));

const cuid = z.string().min(1, 'id requerido');
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'color hex invalido');

/* ------------------------------------------------------------------ auth */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'minimo 8 caracteres'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerTenantSchema = z.object({
  restaurantName: z.string().min(2).max(80),
  /** Se usa en la URL publica: /m/:slug */
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'solo minusculas, numeros y guiones'),
  ownerName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8),
  currency: z.string().length(3).default('ARS'),
  locale: localeSchema.default('es'),
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

/* ---------------------------------------------------------- equipo */

export const teamUserCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(8, 'minimo 8 caracteres'),
  /** No se puede crear otro OWNER desde aca: la titularidad se transfiere. */
  role: z.enum(['ADMIN', 'STAFF']),
});
export type TeamUserCreateInput = z.infer<typeof teamUserCreateSchema>;

export const teamUserUpdateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  role: z.enum(['ADMIN', 'STAFF']).optional(),
  isActive: z.boolean().optional(),
});
export type TeamUserUpdateInput = z.infer<typeof teamUserUpdateSchema>;

/* --------------------------------------------------------- contraseña */

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8, 'minimo 8 caracteres'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'minimo 8 caracteres'),
});

/* ----------------------------------------------------------------- menu */

export const menuQuerySchema = z.object({
  /** Busqueda incremental por nombre o descripcion ("milanesa"). */
  q: z.string().trim().max(80).optional(),
  categoryId: cuid.optional(),
  /** Solo platos aptos para estas dietas (AND). */
  diets: z.array(dietTagSchema).optional(),
  /** Excluye platos que contengan estos alergenos. */
  excludeAllergens: z.array(allergenSchema).optional(),
  /** Solo platos con modelo 3D cargado. */
  only3d: z.coerce.boolean().optional(),
  locale: localeSchema.optional(),
});
export type MenuQuery = z.infer<typeof menuQuerySchema>;

/* ------------------------------------------------------- admin: catalogo */

export const categoryUpsertSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(400).optional(),
  position: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CategoryUpsertInput = z.infer<typeof categoryUpsertSchema>;

export const dishUpsertSchema = z.object({
  categoryId: cuid,
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  /** Precio en centavos: evita por completo la aritmetica con floats. */
  priceCents: z.number().int().min(0),
  /** Precio tachado, para promos. */
  compareAtPriceCents: z.number().int().min(0).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  /** GLB para Android/WebXR y Chrome Scene Viewer. */
  modelGlbUrl: z.string().url().nullable().optional(),
  /** USDZ opcional para AR Quick Look nativo de iOS. */
  modelUsdzUrl: z.string().url().nullable().optional(),
  /** Peso de la porcion, se muestra junto al visor 3D. */
  portionGrams: z.number().int().min(0).nullable().optional(),
  calories: z.number().int().min(0).nullable().optional(),
  prepMinutes: z.number().int().min(0).nullable().optional(),
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  allergens: z.array(allergenSchema).optional(),
  dietTags: z.array(dietTagSchema).optional(),
  ingredients: z.array(z.string().max(60)).max(40).optional(),
});
export type DishUpsertInput = z.infer<typeof dishUpsertSchema>;

/** Cambio de precio en tiempo real sin tocar el resto del plato. */
export const priceUpdateSchema = z.object({
  priceCents: z.number().int().min(0),
});

/** Reordenamiento por arrastre: lista completa de ids en el orden deseado. */
export const reorderSchema = z.object({
  ids: z.array(cuid).min(1),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

/* ------------------------------------------------------- admin: branding */

export const brandingSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  heroImageUrl: z.string().url().nullable().optional(),
  backgroundImageUrl: z.string().url().nullable().optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
  surfaceColor: hexColor.optional(),
  textColor: hexColor.optional(),
  fontFamily: z.string().max(80).optional(),
  /** 'light' | 'dark' | 'system' */
  colorScheme: z.enum(['light', 'dark', 'system']).optional(),
});
export type BrandingInput = z.infer<typeof brandingSchema>;

export const venueSettingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).nullable().optional(),
  whatsapp: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  addressLine: z.string().max(200).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  /** Coordenadas para el mapa; se setean desde el buscador de Google Maps. */
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  googlePlaceId: z.string().max(120).nullable().optional(),
  instagramUrl: z.string().url().nullable().optional(),
  tiktokUrl: z.string().url().nullable().optional(),
  facebookUrl: z.string().url().nullable().optional(),
  openingHours: z.string().max(500).nullable().optional(),
  currency: z.string().length(3).optional(),
  defaultLocale: localeSchema.optional(),
  /** Idiomas ofrecidos al cliente en el selector. */
  enabledLocales: z.array(localeSchema).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  serviceModes: z.array(serviceModeSchema).optional(),
});
export type VenueSettingsInput = z.infer<typeof venueSettingsSchema>;

/* -------------------------------------------------------------- reseñas */

export const reviewCreateSchema = z.object({
  /** Ausente => reseña general del local. */
  dishId: cuid.nullable().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
  authorName: z.string().max(60).optional(),
});
export type ReviewCreateInput = z.infer<typeof reviewCreateSchema>;

export const reviewModerationSchema = z.object({
  status: z.enum(['PUBLISHED', 'HIDDEN']),
  reply: z.string().max(1000).nullable().optional(),
});

/* -------------------------------------------------------------- pedidos */

export const cartItemSchema = z.object({
  dishId: cuid,
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(200).optional(),
});

export const orderCreateSchema = z.object({
  items: z.array(cartItemSchema).min(1, 'el carrito esta vacio'),
  serviceMode: serviceModeSchema.default('DINE_IN'),
  tableLabel: z.string().max(20).nullable().optional(),
  customerName: z.string().max(80).optional(),
  customerPhone: z.string().max(40).optional(),
  customerEmail: z.string().email().optional(),
  notes: z.string().max(400).optional(),
  /** Puntos de fidelidad a canjear en este pedido. */
  redeemPoints: z.number().int().min(0).optional(),
  /** Identifica al comensal anonimo entre sesiones (localStorage). */
  guestId: z.string().max(64).optional(),
  /** Idioma en el que esta mirando la carta: define el idioma del correo. */
  locale: localeSchema.optional(),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderStatusUpdateSchema = z.object({
  status: orderStatusSchema,
});

/* ------------------------------------------------------------ analitica */

export const analyticsEventInputSchema = z.object({
  type: analyticsEventSchema,
  dishId: cuid.nullable().optional(),
  /** Agrupa eventos de una misma visita sin cookies de terceros. */
  sessionId: z.string().min(8).max(64),
  /** Milisegundos que el cliente tuvo el modelo 3D en pantalla. */
  durationMs: z.number().int().min(0).max(1000 * 60 * 30).optional(),
  /** Texto buscado, para el informe de busquedas sin resultado. */
  query: z.string().max(80).optional(),
  locale: localeSchema.optional(),
  value: z.number().int().optional(),
});
export type AnalyticsEventInput = z.infer<typeof analyticsEventInputSchema>;

/** La PWA envia los eventos en lote para no castigar la red del celular. */
export const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventInputSchema).min(1).max(50),
});

export const analyticsRangeSchema = z.object({
  /** Ventana en dias hacia atras. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/* ------------------------------------------------------------ fidelidad */

export const loyaltyLookupSchema = z.object({
  guestId: z.string().min(8).max(64),
});

/* ------------------------------------------------------------------- QR */

export const qrOptionsSchema = z.object({
  /** Una mesa por QR: el pedido llega identificado. */
  tables: z.array(z.string().max(20)).max(60).optional(),
  format: z.enum(['png', 'pdf']).default('pdf'),
  /** Tarjetas por pagina en el PDF. */
  perPage: z.coerce.number().int().min(1).max(8).default(4),
});
export type QrOptionsInput = z.infer<typeof qrOptionsSchema>;

/* ------------------------------------------------------------ traduccion */

export const translateRequestSchema = z.object({
  targetLocale: localeSchema,
  /** Vacio => traduce toda la carta. */
  dishIds: z.array(cuid).optional(),
  /** Reescribe traducciones ya existentes. */
  overwrite: z.boolean().default(false),
});
export type TranslateRequestInput = z.infer<typeof translateRequestSchema>;

/* ------------------------------------------- boton de arrepentimiento */

/**
 * Pedido de revocacion (Res. 424/2020 SCI).
 *
 * Solo nombre y correo son obligatorios, y por norma: la resolucion prohibe
 * exigirle al consumidor registrarse o hacer cualquier otro tramite para usar
 * el boton. Pedirle el numero de operacion seria ese tramite. El correo se pide
 * porque es por donde se le informa el codigo.
 */
export const revocationRequestSchema = z.object({
  name: z.string().trim().min(2, 'decinos como te llamas').max(120),
  email: z.string().email(),
  phone: z.string().trim().max(40).optional(),
  /** Como identifica su contratacion, si se acuerda. Opcional a proposito. */
  reference: z.string().trim().max(200).optional(),
  detail: z.string().trim().max(2000).optional(),
});
export type RevocationRequestInput = z.infer<typeof revocationRequestSchema>;
