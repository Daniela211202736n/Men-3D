/**
 * Capa opcional de IA sobre la API de Claude.
 *
 * Todo lo de este archivo es *mejora*, nunca requisito: sin ANTHROPIC_API_KEY
 * la carta sigue funcionando con las traducciones manuales y el recomendador
 * deterministico. Cada funcion devuelve `null` ante cualquier fallo y lo deja
 * registrado, para que un problema de la pasarela de IA no tumbe un pedido.
 */
import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

import { aiEnabled, env } from '../../env.js';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!aiEnabled) return null;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const AI_MODEL = env.AI_MODEL;

const LOCALE_NAMES: Record<string, string> = {
  es: 'espanol',
  en: 'ingles',
  pt: 'portugues de Brasil',
  fr: 'frances',
  it: 'italiano',
  de: 'aleman',
};

/** Una entrada y una salida de la traduccion de carta. */
export interface TranslatableDish {
  id: string;
  name: string;
  description: string | null;
}

const translationItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
const translationBatchSchema = z.object({
  items: z.array(translationItemSchema),
});

/**
 * Traduce nombres y descripciones de platos. Se pide salida estructurada para
 * poder emparejar cada traduccion con su `id` sin parsear texto libre.
 */
export async function translateDishes(
  dishes: TranslatableDish[],
  sourceLocale: string,
  targetLocale: string,
): Promise<Map<string, { name: string; description: string }> | null> {
  const anthropic = getClient();
  if (!anthropic || dishes.length === 0) return null;

  const from = LOCALE_NAMES[sourceLocale] ?? sourceLocale;
  const to = LOCALE_NAMES[targetLocale] ?? targetLocale;

  const payload = dishes.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description ?? '',
  }));

  try {
    const response = await anthropic.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      // Trabajo acotado y mecanico: no amerita gastar razonamiento profundo.
      output_config: {
        effort: 'low',
        format: zodOutputFormat(translationBatchSchema),
      },
      system:
        'Sos traductor gastronomico profesional. Traduci cartas de restaurante ' +
        'conservando el registro comercial y apetitoso del original. Reglas: ' +
        '(1) no traduzcas nombres propios de platos tradicionales (milanesa, ' +
        'provoleta, empanada, risotto): dejalos y, si hace falta, agrega una ' +
        'aclaracion breve en la descripcion; (2) adapta unidades y cortes de ' +
        'carne al vocabulario del idioma destino; (3) no inventes ingredientes ' +
        'que no figuren en el original; (4) devolve exactamente un item por ' +
        'cada id recibido, con el mismo id.',
      messages: [
        {
          role: 'user',
          content:
            `Traduci del ${from} al ${to} estos platos:\n\n` +
            JSON.stringify(payload, null, 2),
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) return null;

    const byId = new Map<string, { name: string; description: string }>();
    const validIds = new Set(dishes.map((d) => d.id));
    for (const item of parsed.items) {
      // El modelo podria devolver un id que no pedimos: se descarta.
      if (!validIds.has(item.id)) continue;
      byId.set(item.id, { name: item.name, description: item.description });
    }
    return byId;
  } catch (error) {
    logAiError('translateDishes', error);
    return null;
  }
}

const blurbSchema = z.object({
  blurb: z.string(),
});

/**
 * Redacta el texto que acompaña una sugerencia de maridaje. El *que* sugerir lo
 * decide el recomendador deterministico; la IA solo pone las palabras.
 */
export async function writePairingBlurb(input: {
  dishName: string;
  suggestionName: string;
  suggestionCategory: string;
  locale: string;
}): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  try {
    const response = await anthropic.messages.parse({
      model: AI_MODEL,
      max_tokens: 1000,
      output_config: {
        effort: 'low',
        format: zodOutputFormat(blurbSchema),
      },
      system:
        'Escribis micro-copy para un menu digital. Una sola oracion, maximo 14 ' +
        'palabras, en segunda persona, sin signos de exclamacion, sin emojis y ' +
        'sin prometer sabores que no se mencionan. Idioma: el que te indiquen.',
      messages: [
        {
          role: 'user',
          content:
            `Idioma: ${LOCALE_NAMES[input.locale] ?? input.locale}. ` +
            `El cliente eligio "${input.dishName}". ` +
            `Sugerile "${input.suggestionName}" (categoria: ${input.suggestionCategory}). ` +
            'Explica en una oracion por que combinan.',
        },
      ],
    });
    return response.parsed_output?.blurb?.trim() ?? null;
  } catch (error) {
    logAiError('writePairingBlurb', error);
    return null;
  }
}

/**
 * Clasifica los errores del SDK para distinguir lo reintentable (429, 5xx, red)
 * de lo que es culpa nuestra (400, 404) y no se arregla repitiendo.
 */
function logAiError(operation: string, error: unknown): void {
  let detail: string;
  // De lo mas especifico a lo mas general: APIConnectionError y los 4xx
  // concretos son subclases de APIError, asi que van primero.
  if (error instanceof NotFoundError) {
    detail = `modelo o endpoint inexistente (${AI_MODEL})`;
  } else if (error instanceof RateLimitError) {
    detail = 'limite de tasa alcanzado; reintentable';
  } else if (error instanceof AuthenticationError) {
    detail = 'ANTHROPIC_API_KEY invalida';
  } else if (error instanceof APIConnectionError) {
    detail = 'no se pudo conectar con la API; reintentable';
  } else if (error instanceof APIError) {
    detail = `respuesta ${error.status ?? '?'} de la API`;
  } else {
    detail = error instanceof Error ? error.message : String(error);
  }
  console.warn(`[ai:${operation}] desactivado para esta llamada: ${detail}`);
}

export { aiEnabled };
