/**
 * Traductores de filas de Prisma a los DTO de `@men3d/shared`.
 *
 * Toda respuesta publica pasa por aca: es la frontera que decide que campos de
 * la base se exponen y cuales no (por ejemplo `guestId` de una reseña nunca
 * sale, y los textos se resuelven al idioma pedido).
 */
import {
  Allergen,
  DEFAULT_LOCALE,
  DietTag,
  type BrandingDto,
  type CategoryDto,
  type DishDto,
  type Locale,
  type RatingSummaryDto,
  type ReviewDto,
  type ServiceMode,
  type VenueDto,
  type Feature,
  type OrderDto,
  type OrderItemDto,
  type PaymentDto,
  type PaymentStatus,
  type OrderStatus,
} from '@men3d/shared';
import type {
  Branding,
  Category,
  CategoryTranslation,
  Dish,
  DishAllergen,
  DishDietTag,
  DishIngredient,
  DishTranslation,
  Order,
  OrderItem,
  Payment,
  Review,
  Tenant,
} from '@prisma/client';

import { parseEnumList, parseList } from './lists.js';

export const EMPTY_RATING: RatingSummaryDto = {
  average: 0,
  count: 0,
  histogram: [0, 0, 0, 0, 0],
};

/** Mapa dishId -> resumen de calificaciones, listo para inyectar en los DTO. */
export type RatingIndex = Map<string, RatingSummaryDto>;

export function buildRatingSummary(
  rows: Array<{ rating: number; count: number }>,
): RatingSummaryDto {
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of rows) {
    const idx = Math.min(Math.max(row.rating, 1), 5) - 1;
    histogram[idx] = (histogram[idx] ?? 0) + row.count;
    count += row.count;
    sum += row.rating * row.count;
  }
  return {
    average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10,
    count,
    histogram,
  };
}

const DEFAULT_BRANDING: BrandingDto = {
  logoUrl: null,
  faviconUrl: null,
  heroImageUrl: null,
  backgroundImageUrl: null,
  primaryColor: '#2a78d6',
  accentColor: '#eb6834',
  surfaceColor: '#fcfcfb',
  textColor: '#0b0b0b',
  fontFamily: 'Inter, system-ui, sans-serif',
  colorScheme: 'system',
};

export function toBrandingDto(branding: Branding | null): BrandingDto {
  if (!branding) return { ...DEFAULT_BRANDING };
  return {
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    heroImageUrl: branding.heroImageUrl,
    backgroundImageUrl: branding.backgroundImageUrl,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
    surfaceColor: branding.surfaceColor,
    textColor: branding.textColor,
    fontFamily: branding.fontFamily,
    colorScheme: (branding.colorScheme as BrandingDto['colorScheme']) ?? 'system',
  };
}

export function toVenueDto(
  tenant: Tenant & { branding: Branding | null },
  rating: RatingSummaryDto,
  features: Feature[],
): VenueDto {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    description: tenant.description,
    phone: tenant.phone,
    whatsapp: tenant.whatsapp,
    email: tenant.email,
    addressLine: tenant.addressLine,
    city: tenant.city,
    country: tenant.country,
    latitude: tenant.latitude,
    longitude: tenant.longitude,
    googlePlaceId: tenant.googlePlaceId,
    instagramUrl: tenant.instagramUrl,
    tiktokUrl: tenant.tiktokUrl,
    facebookUrl: tenant.facebookUrl,
    openingHours: tenant.openingHours,
    currency: tenant.currency,
    defaultLocale: (tenant.defaultLocale as Locale) ?? DEFAULT_LOCALE,
    enabledLocales: parseList(tenant.enabledLocales) as Locale[],
    taxRateBps: tenant.taxRateBps,
    serviceModes: parseList(tenant.serviceModes) as ServiceMode[],
    branding: toBrandingDto(tenant.branding),
    rating,
    features,
  };
}

export type CategoryWithTranslations = Category & {
  translations?: CategoryTranslation[];
};

export function toCategoryDto(
  category: CategoryWithTranslations,
  locale: Locale,
  dishCount: number,
): CategoryDto {
  const translation = category.translations?.find((t) => t.locale === locale);
  return {
    id: category.id,
    name: translation?.name ?? category.name,
    description: category.description,
    position: category.position,
    dishCount,
  };
}

export type DishWithRelations = Dish & {
  category?: Pick<Category, 'id' | 'name'> | null;
  allergens?: DishAllergen[];
  dietTags?: DishDietTag[];
  ingredients?: DishIngredient[];
  translations?: DishTranslation[];
};

export function toDishDto(
  dish: DishWithRelations,
  opts: {
    currency: string;
    locale: Locale;
    sourceLocale: Locale;
    rating?: RatingSummaryDto;
  },
): DishDto {
  const { currency, locale, sourceLocale } = opts;
  // Solo se busca traduccion si el idioma pedido no es el de carga original.
  const translation =
    locale === sourceLocale
      ? undefined
      : dish.translations?.find((t) => t.locale === locale);

  return {
    id: dish.id,
    categoryId: dish.categoryId,
    categoryName: dish.category?.name ?? '',
    name: translation?.name ?? dish.name,
    description: translation?.description ?? dish.description,
    priceCents: dish.priceCents,
    compareAtPriceCents: dish.compareAtPriceCents,
    currency,
    imageUrl: dish.imageUrl,
    modelGlbUrl: dish.modelGlbUrl,
    modelUsdzUrl: dish.modelUsdzUrl,
    has3d: Boolean(dish.modelGlbUrl),
    portionGrams: dish.portionGrams,
    calories: dish.calories,
    prepMinutes: dish.prepMinutes,
    isAvailable: dish.isAvailable,
    isFeatured: dish.isFeatured,
    position: dish.position,
    allergens: (dish.allergens ?? [])
      .map((a) => a.allergen)
      .filter((a): a is Allergen => a in Allergen),
    dietTags: (dish.dietTags ?? [])
      .map((t) => t.tag)
      .filter((t): t is DietTag => t in DietTag),
    ingredients: (dish.ingredients ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((i) => i.name),
    rating: opts.rating ?? EMPTY_RATING,
    locale: translation ? locale : sourceLocale,
    translated: Boolean(translation),
  };
}

export function toReviewDto(
  review: Review & { dish?: Pick<Dish, 'id' | 'name'> | null },
): ReviewDto {
  return {
    id: review.id,
    dishId: review.dishId,
    dishName: review.dish?.name ?? null,
    rating: review.rating,
    comment: review.comment,
    authorName: review.authorName,
    reply: review.reply,
    status: review.status as ReviewDto['status'],
    createdAt: review.createdAt.toISOString(),
  };
}

export function toOrderItemDto(item: OrderItem): OrderItemDto {
  return {
    id: item.id,
    dishId: item.dishId,
    dishName: item.nameSnapshot,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: item.unitPriceCents * item.quantity,
    notes: item.notes,
  };
}

export function toPaymentDto(
  payment: Payment | null,
  extra: { checkoutUrl?: string | null; clientSecret?: string | null } = {},
): PaymentDto | null {
  if (!payment) return null;
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status as PaymentStatus,
    amountCents: payment.amountCents,
    checkoutUrl: extra.checkoutUrl ?? null,
    clientSecret: extra.clientSecret ?? null,
  };
}

export function toOrderDto(
  order: Order & { items: OrderItem[]; payment?: Payment | null },
  currency: string,
  paymentExtra?: { checkoutUrl?: string | null; clientSecret?: string | null },
): OrderDto {
  return {
    id: order.id,
    code: order.code,
    status: order.status as OrderStatus,
    serviceMode: order.serviceMode as OrderDto['serviceMode'],
    tableLabel: order.tableLabel,
    items: order.items.map(toOrderItemDto),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    currency,
    customerName: order.customerName,
    notes: order.notes,
    pointsEarned: order.pointsEarned,
    pointsRedeemed: order.pointsRedeemed,
    payment: toPaymentDto(order.payment ?? null, paymentExtra),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export { parseEnumList };
