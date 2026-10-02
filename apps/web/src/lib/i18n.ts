/**
 * Textos de la interfaz.
 *
 * Esto traduce el *chrome* de la app (botones, titulos, avisos). El contenido
 * de la carta — nombres y descripciones de los platos — lo traduce el backend y
 * llega ya resuelto en el idioma pedido (ver modules/ai/claude.ts).
 *
 * Diccionario propio en vez de i18next: son ~90 claves y asi la PWA no carga
 * una libreria de i18n completa en la primera visita.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from '@men3d/shared';

type Dict = Record<string, string>;

const es: Dict = {
  'nav.menu': 'Carta',
  'nav.venue': 'El local',
  'nav.cart': 'Pedido',
  'search.placeholder': 'Buscar un plato (ej: milanesa)',
  'search.clear': 'Limpiar',
  'search.results': '{n} resultado(s)',
  'search.empty.title': 'No encontramos nada con eso',
  'search.empty.body': 'Proba con otra palabra o saca algun filtro.',
  'filters.title': 'Filtros',
  'filters.open': 'Filtros',
  'filters.diets': 'Dietas',
  'filters.allergens': 'Sin estos alergenos',
  'filters.only3d': 'Solo con 3D',
  'filters.apply': 'Ver {n} plato(s)',
  'filters.clear': 'Limpiar todo',
  'filters.active': '{n} filtro(s) activo(s)',
  'dish.view3d': 'Ver en 3D',
  'dish.viewAr': 'Ver en mi mesa',
  'dish.arHint': 'Apunta la camara a la mesa',
  'dish.rotateHint': 'Arrastra para girar · pinza para acercar',
  'dish.portion': 'Porcion {grams} g',
  'dish.calories': '{kcal} kcal',
  'dish.prep': 'Listo en {min} min',
  'dish.ingredients': 'Ingredientes',
  'dish.allergens': 'Contiene',
  'dish.allergensNone': 'Sin alergenos declarados',
  'dish.unavailable': 'No disponible hoy',
  'dish.add': 'Agregar al pedido',
  'dish.added': 'Agregado al pedido',
  'dish.pairings': 'Combina bien con',
  'dish.reviews': 'Opiniones',
  'dish.noReviews': 'Todavia no hay opiniones de este plato.',
  'dish.translated': 'Traduccion automatica',
  'review.write': 'Escribir una opinion',
  'review.rating': 'Tu puntuacion',
  'review.comment': 'Tu comentario (opcional)',
  'review.name': 'Tu nombre (opcional)',
  'review.send': 'Publicar opinion',
  'review.thanks': 'Gracias por tu opinion',
  'review.reply': 'Respuesta del restaurante',
  'cart.title': 'Tu pedido',
  'cart.empty': 'Tu pedido esta vacio',
  'cart.emptyCta': 'Ver la carta',
  'cart.subtotal': 'Subtotal',
  'cart.tax': 'IVA',
  'cart.discount': 'Descuento por puntos',
  'cart.total': 'Total',
  'cart.table': 'Mesa',
  'cart.notes': 'Aclaraciones para la cocina',
  'cart.name': 'Tu nombre',
  'cart.checkout': 'Pagar y enviar a cocina',
  'cart.remove': 'Quitar',
  'cart.points': 'Usar {n} puntos ({amount})',
  'cart.pointsBalance': 'Tenes {n} puntos',
  'order.title': 'Pedido {code}',
  'order.status.PENDING_PAYMENT': 'Esperando el pago',
  'order.status.PAID': 'Pago confirmado',
  'order.status.IN_KITCHEN': 'En cocina',
  'order.status.READY': 'Listo para servir',
  'order.status.SERVED': 'Servido',
  'order.status.CANCELED': 'Cancelado',
  'order.earned': 'Ganaste {n} puntos',
  'order.track': 'Seguir el pedido',
  'venue.hours': 'Horarios',
  'venue.address': 'Direccion',
  'venue.map': 'Ver en el mapa',
  'venue.call': 'Llamar',
  'venue.whatsapp': 'Escribir por WhatsApp',
  'venue.reviews': 'Opiniones del local',
  'venue.share': 'Compartir la carta',
  'privacy.title': 'Tus datos',
  'privacy.link': 'Tus datos y privacidad',
  'common.loading': 'Cargando...',
  'common.retry': 'Reintentar',
  'common.error': 'Algo salio mal',
  'common.back': 'Volver',
  'common.close': 'Cerrar',
  'common.of': 'de',
  'theme.toggle': 'Cambiar tema',
  'lang.label': 'Idioma',
};

const en: Dict = {
  'nav.menu': 'Menu',
  'nav.venue': 'Venue',
  'nav.cart': 'Order',
  'search.placeholder': 'Search a dish (e.g. schnitzel)',
  'search.clear': 'Clear',
  'search.results': '{n} result(s)',
  'search.empty.title': 'Nothing matched that',
  'search.empty.body': 'Try another word or remove a filter.',
  'filters.title': 'Filters',
  'filters.open': 'Filters',
  'filters.diets': 'Diets',
  'filters.allergens': 'Without these allergens',
  'filters.only3d': '3D only',
  'filters.apply': 'Show {n} dish(es)',
  'filters.clear': 'Clear all',
  'filters.active': '{n} active filter(s)',
  'dish.view3d': 'View in 3D',
  'dish.viewAr': 'View on my table',
  'dish.arHint': 'Point your camera at the table',
  'dish.rotateHint': 'Drag to rotate · pinch to zoom',
  'dish.portion': '{grams} g portion',
  'dish.calories': '{kcal} kcal',
  'dish.prep': 'Ready in {min} min',
  'dish.ingredients': 'Ingredients',
  'dish.allergens': 'Contains',
  'dish.allergensNone': 'No declared allergens',
  'dish.unavailable': 'Not available today',
  'dish.add': 'Add to order',
  'dish.added': 'Added to your order',
  'dish.pairings': 'Goes well with',
  'dish.reviews': 'Reviews',
  'dish.noReviews': 'No reviews for this dish yet.',
  'dish.translated': 'Machine translation',
  'review.write': 'Write a review',
  'review.rating': 'Your rating',
  'review.comment': 'Your comment (optional)',
  'review.name': 'Your name (optional)',
  'review.send': 'Post review',
  'review.thanks': 'Thanks for your review',
  'review.reply': 'Reply from the restaurant',
  'cart.title': 'Your order',
  'cart.empty': 'Your order is empty',
  'cart.emptyCta': 'Browse the menu',
  'cart.subtotal': 'Subtotal',
  'cart.tax': 'Tax',
  'cart.discount': 'Points discount',
  'cart.total': 'Total',
  'cart.table': 'Table',
  'cart.notes': 'Notes for the kitchen',
  'cart.name': 'Your name',
  'cart.checkout': 'Pay and send to kitchen',
  'cart.remove': 'Remove',
  'cart.points': 'Use {n} points ({amount})',
  'cart.pointsBalance': 'You have {n} points',
  'order.title': 'Order {code}',
  'order.status.PENDING_PAYMENT': 'Waiting for payment',
  'order.status.PAID': 'Payment confirmed',
  'order.status.IN_KITCHEN': 'In the kitchen',
  'order.status.READY': 'Ready to serve',
  'order.status.SERVED': 'Served',
  'order.status.CANCELED': 'Canceled',
  'order.earned': 'You earned {n} points',
  'order.track': 'Track order',
  'venue.hours': 'Opening hours',
  'venue.address': 'Address',
  'venue.map': 'Open in maps',
  'venue.call': 'Call',
  'venue.whatsapp': 'Message on WhatsApp',
  'venue.reviews': 'Venue reviews',
  'venue.share': 'Share the menu',
  'privacy.title': 'Your data',
  'privacy.link': 'Your data and privacy',
  'common.loading': 'Loading...',
  'common.retry': 'Retry',
  'common.error': 'Something went wrong',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.of': 'of',
  'theme.toggle': 'Toggle theme',
  'lang.label': 'Language',
};

const pt: Dict = {
  ...en,
  'privacy.title': 'Seus dados',
  'privacy.link': 'Seus dados e privacidade',
  'nav.menu': 'Menu',
  'nav.venue': 'O local',
  'nav.cart': 'Pedido',
  'search.placeholder': 'Buscar um prato (ex: milanesa)',
  'search.empty.title': 'Nada encontrado',
  'search.empty.body': 'Tente outra palavra ou remova um filtro.',
  'filters.title': 'Filtros',
  'dish.view3d': 'Ver em 3D',
  'dish.viewAr': 'Ver na minha mesa',
  'dish.add': 'Adicionar ao pedido',
  'dish.pairings': 'Combina com',
  'dish.reviews': 'Avaliacoes',
  'cart.title': 'Seu pedido',
  'cart.total': 'Total',
  'cart.checkout': 'Pagar e enviar para a cozinha',
  'common.loading': 'Carregando...',
};

const DICTS: Record<string, Dict> = { es, en, pt, fr: en, it: en, de: en };

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Devuelve la funcion de traduccion para un idioma. */
export function createTranslate(locale: Locale): Translate {
  const dict = DICTS[locale] ?? es;
  return (key, vars) => {
    // Cae al español (idioma de origen del producto) y, en ultima instancia, a
    // la propia clave: una pantalla con una clave visible es mas util que una
    // pantalla vacia, y delata el texto que falta.
    let text = dict[key] ?? es[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}

/** Idioma preferido del dispositivo, si el restaurante lo ofrece. */
export function detectLocale(enabled: readonly Locale[]): Locale {
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const base = candidate.split('-')[0]?.toLowerCase() ?? '';
    if (isLocale(base) && enabled.includes(base)) return base;
  }
  return enabled[0] ?? DEFAULT_LOCALE;
}

/** Nombre de cada idioma en su propia lengua, para el selector. */
export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
  fr: 'Français',
  it: 'Italiano',
  de: 'Deutsch',
};

/** Etiquetas de alergenos y dietas, por idioma. */
export const ALLERGEN_LABELS: Record<string, Record<string, string>> = {
  es: {
    GLUTEN: 'Gluten', CRUSTACEANS: 'Crustaceos', EGGS: 'Huevo', FISH: 'Pescado',
    PEANUTS: 'Cacahuate', SOY: 'Soja', MILK: 'Lacteos', NUTS: 'Frutos secos',
    CELERY: 'Apio', MUSTARD: 'Mostaza', SESAME: 'Sesamo', SULPHITES: 'Sulfitos',
    LUPIN: 'Altramuz', MOLLUSCS: 'Moluscos',
  },
  en: {
    GLUTEN: 'Gluten', CRUSTACEANS: 'Crustaceans', EGGS: 'Eggs', FISH: 'Fish',
    PEANUTS: 'Peanuts', SOY: 'Soy', MILK: 'Milk', NUTS: 'Tree nuts',
    CELERY: 'Celery', MUSTARD: 'Mustard', SESAME: 'Sesame', SULPHITES: 'Sulphites',
    LUPIN: 'Lupin', MOLLUSCS: 'Molluscs',
  },
};

export const DIET_LABELS: Record<string, Record<string, string>> = {
  es: {
    VEGETARIAN: 'Vegetariano', VEGAN: 'Vegano', GLUTEN_FREE: 'Sin TACC',
    LACTOSE_FREE: 'Sin lactosa', KETO: 'Keto', HALAL: 'Halal',
    KOSHER: 'Kosher', SPICY: 'Picante',
  },
  en: {
    VEGETARIAN: 'Vegetarian', VEGAN: 'Vegan', GLUTEN_FREE: 'Gluten free',
    LACTOSE_FREE: 'Lactose free', KETO: 'Keto', HALAL: 'Halal',
    KOSHER: 'Kosher', SPICY: 'Spicy',
  },
};

export function allergenLabel(code: string, locale: Locale): string {
  return ALLERGEN_LABELS[locale]?.[code] ?? ALLERGEN_LABELS.es?.[code] ?? code;
}

export function dietLabel(code: string, locale: Locale): string {
  return DIET_LABELS[locale]?.[code] ?? DIET_LABELS.es?.[code] ?? code;
}
