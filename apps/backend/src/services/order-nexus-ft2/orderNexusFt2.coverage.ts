import db from 'api-db';
import type { OrderFactsPeriod } from 'api-src/services/order-facts/orderFacts.types';

export type OrdersFt2Coverage = {
  totalLineItems: number;
  presentCost: number;
  missingCost: number;
  completenessPct: number | null;
};

export async function getOrderNexusFt2Coverage(input: {
  shopId: number;
  period: OrderFactsPeriod;
}): Promise<OrdersFt2Coverage> {
  const { shopId, period } = input;

  const row = await db('canonical_order_line_items')
    .where('shop_id', shopId)
    .andWhere('created_at', '>=', period.from)
    .andWhere('created_at', '<=', period.to)
    .select(
      db.raw('COUNT(id) as total'),
      db.raw(
        'SUM(CASE WHEN estimated_unit_cost IS NULL THEN 1 ELSE 0 END) as missing'
      )
    )
    .first<{
      total: string | null;
      missing: string | null;
    }>();

  const totalLineItems = Number(row?.total ?? 0);
  const missingCost = Number(row?.missing ?? 0);
  const presentCost = totalLineItems - missingCost;

  const completenessPct =
    totalLineItems > 0
      ? Math.round((presentCost / totalLineItems) * 100)
      : null;

  return {
    totalLineItems,
    presentCost,
    missingCost,
    completenessPct,
  };
}