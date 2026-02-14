import db from 'api-db';
import { FT2DateRangePreset, resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';

export type OrdersFt2TimeseriesPoint = {
  date: string;
  ordersObserved: number;
  revenueTotal: number;
};

function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const current = new Date(from);
  const end = new Date(to);

  current.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    days.push(current.toISOString().slice(0, 10)); // YYYY-MM-DD
    current.setDate(current.getDate() + 1);
  }

  return days;
}

export async function getOrderNexusFt2Timeseries(input: {
  shopId: number;
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string };
}): Promise<{
  series: OrdersFt2TimeseriesPoint[];
}> {
  const { shopId, range } = input;

  type NonCustomPreset = Exclude<FT2DateRangePreset, 'custom'>;

/**
 * NOTE ON FT2 RANGE NARROWING
 * --------------------------
 * `FT2DateRangePreset` includes 'custom', but
 * `resolveFt2PeriodFromPreset` requires that
 * 'custom' always carries explicit from/to values.
 *
 * TypeScript cannot infer this constraint through
 * control flow alone, so we perform an explicit
 * narrowing cast here to preserve type safety.
 */
const { from, to } =
  typeof range === 'string'
    ? resolveFt2PeriodFromPreset({ preset: range as NonCustomPreset })
    : range.preset === 'custom'
      ? resolveFt2PeriodFromPreset(range)
      : resolveFt2PeriodFromPreset({
          preset: range.preset as NonCustomPreset,
        });

  const rows = await db('orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .select(
      db.raw(`DATE(order_created_at) as date`),
      db.raw(`COUNT(lasyncro_order_id) as ordersObserved`),
      db.raw(`COALESCE(SUM(total_price), 0) as revenueTotal`)
    )
    .groupByRaw('DATE(order_created_at)')
    .orderBy('date', 'asc');

  if (rows.length === 0) {
    return { series: [] };
  }

  const byDate = new Map<string, { ordersObserved: number; revenueTotal: number }>();

  rows.forEach((r: any) => {
    byDate.set(r.date, {
      ordersObserved: Number(r.ordersObserved),
      revenueTotal: Number(r.revenueTotal),
    });
  });

  const days = enumerateDays(from, to);

  const series = days.map((date) => {
    const row = byDate.get(date);

    return {
      date,
      ordersObserved: row ? row.ordersObserved : 0,
      revenueTotal: row ? row.revenueTotal : 0,
    };
  });

  return { series };
}