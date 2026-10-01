import { randomBytes, randomInt } from 'node:crypto';

/** Alfabeto sin caracteres ambiguos (0/O, 1/I): se canta en voz alta. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Codigo corto de pedido, legible para el comensal y el mostrador. */
export function generateOrderCode(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Token url-safe para los QR de mesa. */
export function generateQrToken(): string {
  return randomBytes(6).toString('base64url');
}

/** Nombre de archivo opaco para los assets subidos (sin datos del usuario). */
export function generateAssetName(extension: string): string {
  return `${randomBytes(16).toString('hex')}.${extension}`;
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
