/**
 * Las listas cortas (idiomas habilitados, modos de servicio, features del plan)
 * viajan como texto separado por comas para que el esquema sea portable entre
 * SQLite y PostgreSQL sin tipos array. Estos helpers son el unico lugar que
 * conoce ese detalle de almacenamiento.
 */

export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function serializeList(values: readonly string[] | undefined): string {
  if (!values?.length) return '';
  // Se deduplica preservando el orden que eligio el usuario.
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(',');
}

/** Filtra una lista cruda dejando solo los valores de un vocabulario conocido. */
export function parseEnumList<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T[] {
  const set = new Set<string>(allowed);
  return parseList(value).filter((v): v is T => set.has(v));
}
