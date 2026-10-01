-- Busqueda insensible a tildes y tolerante a errores de tipeo.
--
-- `mode: 'insensitive'` de Prisma resuelve mayusculas pero NO tildes: en una
-- carta en español eso deja afuera medio vocabulario. Quien escribe "cafe" en
-- el teclado del celular no encuentra "Café cortado", y el restaurante no tiene
-- forma de saber por que nadie pide ese plato.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- `unaccent()` es STABLE, no IMMUTABLE —depende del diccionario, que se puede
-- cambiar— y PostgreSQL no indexa expresiones que no sean IMMUTABLE. Este
-- envoltorio fija el diccionario, lo que vuelve el resultado determinista y
-- permite construir el indice. Es el patron recomendado en la documentacion de
-- PostgreSQL para este caso exacto.
CREATE OR REPLACE FUNCTION men3d_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', lower($1)) $$;

-- Indices GIN de trigramas sobre el texto ya normalizado. Sirven tanto para
-- `LIKE '%...%'` (que sin esto obliga a recorrer la tabla entera) como para la
-- similitud difusa.
CREATE INDEX IF NOT EXISTS "Dish_name_sin_tildes_idx"
  ON "Dish" USING gin (men3d_unaccent("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Dish_description_sin_tildes_idx"
  ON "Dish" USING gin (men3d_unaccent(coalesce("description", '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DishIngredient_name_sin_tildes_idx"
  ON "DishIngredient" USING gin (men3d_unaccent("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DishTranslation_name_sin_tildes_idx"
  ON "DishTranslation" USING gin (men3d_unaccent("name") gin_trgm_ops);
