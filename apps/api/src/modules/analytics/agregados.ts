/**
 * Agregacion de la analitica en SQL, no en memoria.
 *
 * El informe se armaba trayendo cada evento del periodo a Node y contandolos
 * ahi. Medido con un año de un local activo —654.000 eventos, que es un volumen
 * normal, no extremo:
 *
 *     7 dias     0,25 s
 *    30 dias     1,2  s
 *    90 dias     3,7  s
 *   365 dias    13,3  s        la pantalla anual, inservible
 *
 * La misma cuenta como `GROUP BY` en PostgreSQL: **110 milisegundos**. No es
 * que agregar en memoria sea lento: es que mandar 654.000 filas por el cable
 * para contarlas lo es. La base ya tiene los datos y sabe contar.
 *
 * Por eso esto NO es la tabla de rollup diario que proponia la arquitectura.
 * Un rollup agrega una tabla, un job nocturno, datos que se quedan viejos y una
 * recarga historica para mantener; un `GROUP BY` resuelve el mismo problema
 * ahora, sin nada de eso, y 120 veces mas rapido. El rollup sigue siendo el
 * paso siguiente, pero recien cuando el `GROUP BY` deje de alcanzar.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../../prisma.js';

/** Conteo y sesiones unicas por tipo de evento. */
export interface PorTipo {
  type: string;
  eventos: number;
  sesiones: number;
}

export async function contarPorTipo(
  tenantId: string,
  desde: Date,
): Promise<{ filas: PorTipo[]; sesionesTotales: number }> {
  const [filas, totales] = await Promise.all([
    prisma.$queryRaw<Array<{ type: string; eventos: bigint; sesiones: bigint }>>`
      SELECT "type", count(*) AS eventos, count(DISTINCT "sessionId") AS sesiones
      FROM "AnalyticsEvent"
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${desde}
      GROUP BY "type"`,
    prisma.$queryRaw<Array<{ sesiones: bigint }>>`
      SELECT count(DISTINCT "sessionId") AS sesiones
      FROM "AnalyticsEvent"
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${desde}`,
  ]);

  return {
    filas: filas.map((f) => ({
      type: f.type,
      eventos: Number(f.eventos),
      sesiones: Number(f.sesiones),
    })),
    sesionesTotales: Number(totales[0]?.sesiones ?? 0),
  };
}

/** Vistas en 3D por dia, para la serie temporal. */
export async function vistas3dPorDia(
  tenantId: string,
  desde: Date,
): Promise<Map<string, number>> {
  const filas = await prisma.$queryRaw<Array<{ dia: Date; vistas: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS dia, count(*) AS vistas
    FROM "AnalyticsEvent"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${desde}
      AND "type" = 'DISH_VIEW_3D'
    GROUP BY 1`;
  return new Map(filas.map((f) => [f.dia.toISOString().slice(0, 10), Number(f.vistas)]));
}

export interface PorPlato {
  dishId: string;
  views3d: number;
  rotations: number;
  arLaunches: number;
  addToCarts: number;
  viewMsTotal: number;
  viewMsSamples: number;
}

/**
 * Lo que pasa con cada plato.
 *
 * `FILTER` en vez de cinco consultas o cinco pasadas: PostgreSQL resuelve los
 * cinco conteos en un solo recorrido de la tabla.
 */
export async function porPlato(tenantId: string, desde: Date): Promise<PorPlato[]> {
  const filas = await prisma.$queryRaw<
    Array<{
      dishId: string;
      views3d: bigint;
      rotations: bigint;
      arlaunches: bigint;
      addtocarts: bigint;
      viewmstotal: bigint | null;
      viewmssamples: bigint;
    }>
  >`
    SELECT
      "dishId",
      count(*) FILTER (WHERE "type" = 'DISH_VIEW_3D')  AS views3d,
      count(*) FILTER (WHERE "type" = 'DISH_ROTATE')   AS rotations,
      count(*) FILTER (WHERE "type" = 'AR_LAUNCH')     AS arlaunches,
      count(*) FILTER (WHERE "type" = 'ADD_TO_CART')   AS addtocarts,
      COALESCE(sum("durationMs") FILTER (
        WHERE "type" = 'DISH_VIEW_3D' AND "durationMs" > 0), 0) AS viewmstotal,
      count(*) FILTER (
        WHERE "type" = 'DISH_VIEW_3D' AND "durationMs" > 0)     AS viewmssamples
    FROM "AnalyticsEvent"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${desde}
      AND "dishId" IS NOT NULL
    GROUP BY "dishId"`;

  return filas.map((f) => ({
    dishId: f.dishId,
    views3d: Number(f.views3d),
    rotations: Number(f.rotations),
    arLaunches: Number(f.arlaunches),
    addToCarts: Number(f.addtocarts),
    viewMsTotal: Number(f.viewmstotal ?? 0),
    viewMsSamples: Number(f.viewmssamples),
  }));
}

export interface Busqueda {
  term: string;
  searches: number;
  zeroResults: number;
}

/**
 * Lo que busca la gente, y que tan seguido no encuentra nada.
 *
 * El limite va en SQL: de las busquedas solo se muestran las 15 primeras, y no
 * tiene sentido traer el resto para descartarlo.
 */
export async function busquedas(
  tenantId: string,
  desde: Date,
  limite = 15,
): Promise<Busqueda[]> {
  const filas = await prisma.$queryRaw<
    Array<{ term: string; searches: bigint; zeroresults: bigint }>
  >`
    SELECT
      lower(btrim("query")) AS term,
      count(*) AS searches,
      -- La columna value lleva la cantidad de resultados: 0 = hueco de carta,
      -- o un sinonimo que no contemplamos.
      count(*) FILTER (WHERE "value" = 0) AS zeroresults
    FROM "AnalyticsEvent"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${desde}
      AND "type" = 'SEARCH'
      AND "query" IS NOT NULL
      AND btrim("query") <> ''
    GROUP BY 1
    -- El desempate alfabetico no es cosmetico: sin el, dos terminos con el
    -- mismo conteo salen en orden distinto en cada consulta y el tablero
    -- parece parpadear con datos que no cambiaron.
    ORDER BY searches DESC, term ASC
    LIMIT ${Prisma.sql`${limite}`}`;

  return filas.map((f) => ({
    term: f.term,
    searches: Number(f.searches),
    zeroResults: Number(f.zeroresults),
  }));
}
