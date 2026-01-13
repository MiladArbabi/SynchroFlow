import db from 'api-db';
import type { OrderFactsPeriod } from 'api-src/services/order-facts/orderFacts.types';

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
  period: OrderFactsPeriod;
}): Promise<{
  period: OrderFactsPeriod;
  series: OrdersFt2TimeseriesPoint[];
}> {
  const { shopId, period } = input;

  const rows = await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .select(
      db.raw(`DATE(order_created_at) as date`),
      db.raw(`COUNT(canonical_order_id) as ordersObserved`),
      db.raw(`COALESCE(SUM(total_price), 0) as revenueTotal`)
    )
    .groupByRaw('DATE(order_created_at)')
    .orderBy('date', 'asc');

  if (rows.length === 0) {
    return { period, series: [] };
  }

  const byDate = new Map<string, { ordersObserved: number; revenueTotal: number }>();

  rows.forEach((r: any) => {
    byDate.set(r.date, {
      ordersObserved: Number(r.ordersObserved),
      revenueTotal: Number(r.revenueTotal),
    });
  });

  const days = enumerateDays(period.from, period.to);

  const series = days.map((date) => {
    const row = byDate.get(date);

    return {
      date,
      ordersObserved: row ? row.ordersObserved : 0,
      revenueTotal: row ? row.revenueTotal : 0,
    };
  });

  return { period, series };
}