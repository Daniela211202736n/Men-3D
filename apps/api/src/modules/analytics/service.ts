/**
 * Analitica de comportamiento.
 *
 * La ingesta es barata (un insert por evento, en lote) y la lectura agrega por
 * rango de fechas. A escala de un restaurante esto rinde de sobra; cuando un
 * tenant pase del millon de eventos conviene mover los informes a una tabla de
 * rollup diario (ver docs/ARCHITECTURE.md, seccion "Escalar la analitica").
 */
import {
  AnalyticsEvent,
  type AnalyticsDashboardDto,
  type AnalyticsEventInput,
  type DishPerformanceRowDto,
  type FunnelStageDto,
  type SearchTermRowDto,
  type TimeseriesPointDto,
} from '@men3d/shared';

import { prisma } from '../../prisma.js';

/** Inserta un lote de eventos. Los platos inexistentes se guardan sin dishId. */
export async function ingestEvents(
  tenantId: string,
  events: AnalyticsEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;

  // Se validan los ids de plato contra el tenant: un evento no puede inventar
  // trafico para el plato de otro restaurante.
  const dishIds = [...new Set(events.map((e) => e.dishId).filter(Boolean))] as string[];
  const validDishIds = new Set(
    dishIds.length
      ? (
          await prisma.dish.findMany({
            where: { id: { in: dishIds }, tenantId },
            select: { id: true },
          })
        ).map((d) => d.id)
      : [],
  );

  const result = await prisma.analyticsEvent.createMany({
    data: events.map((e) => ({
      tenantId,
      type: e.type,
      dishId: e.dishId && validDishIds.has(e.dishId) ? e.dishId : null,
      sessionId: e.sessionId,
      durationMs: e.durationMs ?? null,
      query: e.query?.slice(0, 80) ?? null,
      locale: e.locale ?? null,
      value: e.value ?? null,
    })),
  });
  return result.count;
}

function startOfRange(days: number): Date {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return since;
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

export async function getDashboard(
  tenantId: string,
  currency: string,
  days: number,
): Promise<AnalyticsDashboardDto> {
  const since = startOfRange(days);

  const [events, orders, orderItems] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: {
        type: true,
        dishId: true,
        sessionId: true,
        durationMs: true,
        query: true,
        value: true,
        createdAt: true,
      },
    }),
    prisma.order.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
        status: { in: ['PAID', 'IN_KITCHEN', 'READY', 'SERVED'] },
      },
      select: { id: true, totalCents: true, createdAt: true },
    }),
    prisma.orderItem.findMany({
      where: {
        order: {
          tenantId,
          createdAt: { gte: since },
          status: { in: ['PAID', 'IN_KITCHEN', 'READY', 'SERVED'] },
        },
      },
      select: {
        dishId: true,
        quantity: true,
        unitPriceCents: true,
        nameSnapshot: true,
      },
    }),
  ]);

  // ---------------------------------------------------------------- totales
  const sessionsByStage = new Map<string, Set<string>>();
  const countsByType = new Map<string, number>();
  const allSessions = new Set<string>();

  for (const event of events) {
    countsByType.set(event.type, (countsByType.get(event.type) ?? 0) + 1);
    allSessions.add(event.sessionId);
    const stage = sessionsByStage.get(event.type) ?? new Set<string>();
    stage.add(event.sessionId);
    sessionsByStage.set(event.type, stage);
  }

  const revenueCents = orders.reduce((acc, o) => acc + o.totalCents, 0);
  const orderCount = orders.length;
  const dishOpens = countsByType.get(AnalyticsEvent.DISH_OPEN) ?? 0;
  const views3d = countsByType.get(AnalyticsEvent.DISH_VIEW_3D) ?? 0;

  const totals = {
    menuOpens: countsByType.get(AnalyticsEvent.MENU_OPEN) ?? 0,
    uniqueSessions: allSessions.size,
    views3d,
    arLaunches: countsByType.get(AnalyticsEvent.AR_LAUNCH) ?? 0,
    addToCarts: countsByType.get(AnalyticsEvent.ADD_TO_CART) ?? 0,
    orders: orderCount,
    revenueCents,
    conversionRate:
      allSessions.size === 0
        ? 0
        : Math.round((orderCount / allSessions.size) * 1000) / 10,
    view3dRate:
      dishOpens === 0 ? 0 : Math.round((views3d / dishOpens) * 1000) / 10,
  };

  // ------------------------------------------------------------ serie diaria
  const timeseriesMap = new Map<string, TimeseriesPointDto>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(since);
    day.setUTCDate(day.getUTCDate() + i);
    timeseriesMap.set(isoDay(day), {
      date: isoDay(day),
      views3d: 0,
      orders: 0,
      revenueCents: 0,
    });
  }
  for (const event of events) {
    if (event.type !== AnalyticsEvent.DISH_VIEW_3D) continue;
    const point = timeseriesMap.get(isoDay(event.createdAt));
    if (point) point.views3d += 1;
  }
  for (const order of orders) {
    const point = timeseriesMap.get(isoDay(order.createdAt));
    if (point) {
      point.orders += 1;
      point.revenueCents += order.totalCents;
    }
  }

  // ------------------------- interes visual vs ventas reales, plato por plato
  interface Acc {
    views3d: number;
    rotations: number;
    arLaunches: number;
    addToCarts: number;
    viewMsTotal: number;
    viewMsSamples: number;
  }
  const perDish = new Map<string, Acc>();
  const touch = (dishId: string): Acc => {
    const acc =
      perDish.get(dishId) ??
      ({
        views3d: 0,
        rotations: 0,
        arLaunches: 0,
        addToCarts: 0,
        viewMsTotal: 0,
        viewMsSamples: 0,
      } satisfies Acc);
    perDish.set(dishId, acc);
    return acc;
  };

  for (const event of events) {
    if (!event.dishId) continue;
    const acc = touch(event.dishId);
    switch (event.type) {
      case AnalyticsEvent.DISH_VIEW_3D:
        acc.views3d += 1;
        if (event.durationMs && event.durationMs > 0) {
          acc.viewMsTotal += event.durationMs;
          acc.viewMsSamples += 1;
        }
        break;
      case AnalyticsEvent.DISH_ROTATE:
        acc.rotations += 1;
        break;
      case AnalyticsEvent.AR_LAUNCH:
        acc.arLaunches += 1;
        break;
      case AnalyticsEvent.ADD_TO_CART:
        acc.addToCarts += 1;
        break;
      default:
        break;
    }
  }

  const salesByDish = new Map<string, { units: number; revenue: number; name: string }>();
  for (const item of orderItems) {
    const entry =
      salesByDish.get(item.dishId) ??
      { units: 0, revenue: 0, name: item.nameSnapshot };
    entry.units += item.quantity;
    entry.revenue += item.quantity * item.unitPriceCents;
    salesByDish.set(item.dishId, entry);
  }

  const dishIds = [...new Set([...perDish.keys(), ...salesByDish.keys()])];
  const dishNames = new Map(
    (
      await prisma.dish.findMany({
        where: { id: { in: dishIds }, tenantId },
        select: { id: true, name: true },
      })
    ).map((d) => [d.id, d.name]),
  );

  const topDishes: DishPerformanceRowDto[] = dishIds
    .map((dishId) => {
      const acc = perDish.get(dishId);
      const sales = salesByDish.get(dishId);
      const views = acc?.views3d ?? 0;
      const units = sales?.units ?? 0;
      return {
        dishId,
        dishName: dishNames.get(dishId) ?? sales?.name ?? 'Plato dado de baja',
        views3d: views,
        rotations: acc?.rotations ?? 0,
        arLaunches: acc?.arLaunches ?? 0,
        addToCarts: acc?.addToCarts ?? 0,
        unitsSold: units,
        revenueCents: sales?.revenue ?? 0,
        // La metrica que importa: mucho mirar y poco pedir = foto linda, plato
        // que no convence (precio, descripcion o la porcion que se ve en 3D).
        lookToBookRate: views === 0 ? 0 : Math.round((units / views) * 1000) / 10,
        avgViewSeconds:
          acc && acc.viewMsSamples > 0
            ? Math.round((acc.viewMsTotal / acc.viewMsSamples / 1000) * 10) / 10
            : 0,
      } satisfies DishPerformanceRowDto;
    })
    .sort((a, b) => b.views3d - a.views3d || b.unitsSold - a.unitsSold)
    .slice(0, 20);

  // ----------------------------------------------------------------- embudo
  const funnelStages: Array<FunnelStageDto['stage']> = [
    'MENU_OPEN',
    'DISH_OPEN',
    'DISH_VIEW_3D',
    'ADD_TO_CART',
    'PURCHASE',
  ];
  const topSessions = sessionsByStage.get('MENU_OPEN')?.size ?? 0;
  const funnel: FunnelStageDto[] = funnelStages.map((stage) => {
    const sessions = sessionsByStage.get(stage)?.size ?? 0;
    return {
      stage,
      sessions,
      rateFromTop:
        topSessions === 0 ? 0 : Math.round((sessions / topSessions) * 1000) / 10,
    };
  });

  // ------------------------------------------------------------- busquedas
  const searchMap = new Map<string, SearchTermRowDto>();
  for (const event of events) {
    if (event.type !== AnalyticsEvent.SEARCH || !event.query) continue;
    const term = event.query.trim().toLowerCase();
    if (!term) continue;
    const row = searchMap.get(term) ?? { term, searches: 0, zeroResults: 0 };
    row.searches += 1;
    // `value` lleva la cantidad de resultados: 0 = hueco de carta o sinonimo
    // que no contemplamos ("hamburguesa" cuando en la carta dice "burger").
    if (event.value === 0) row.zeroResults += 1;
    searchMap.set(term, row);
  }

  return {
    rangeDays: days,
    currency,
    totals,
    timeseries: [...timeseriesMap.values()],
    topDishes,
    funnel,
    topSearches: [...searchMap.values()]
      .sort((a, b) => b.searches - a.searches)
      .slice(0, 15),
  };
}
