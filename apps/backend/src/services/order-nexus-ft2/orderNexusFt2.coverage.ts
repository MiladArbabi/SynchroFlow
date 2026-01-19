import db from 'api-db';
import { FT2RangeInput, resolveFt2Range } from 'api-src/utils/ft2Period';

export type OrdersFt2Coverage = {
  totalLineItems: number;
  presentCost: number;
  missingCost: number;
  completenessPct: number | null;
};

export async function getOrderNexusFt2Coverage(
  {
    shopId,
    range,
  }: {
    shopId: number;
    range: FT2RangeInput;
  }
): Promise<OrdersFt2Coverage> {
  const { from, to } = resolveFt2Range(range);

  const row = await db('canonical_order_line_items')
    .where('shop_id', shopId)
    .andWhere('created_at', '>=', from)
    .andWhere('created_at', '<=', to)
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