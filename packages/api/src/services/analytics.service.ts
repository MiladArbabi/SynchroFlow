//packages/api/src/services/analytics.service.ts
import db from '../db';

export async function calculateGrossRevenue(shopId: number): Promise<number> {
  const result = await db('historical_sales as hs')
    .join('inventory_truth as it', 'hs.sku', 'it.sku')
    .where('hs.shop_id', shopId)
    .sum({ total: db.raw('hs.quantity_sold * it.price') })
    .first();

  // The result of a sum is a string by default, so we parse it to a float.
  // If there are no sales, the result will be null, so we default to 0.
  return result && result.total ? parseFloat(result.total as string) : 0;
}