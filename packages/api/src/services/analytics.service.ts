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

export async function calculateGrossMargin(shopId: number): Promise<number> {
  // We can reuse the function we already built to get total revenue
  const totalRevenue = await calculateGrossRevenue(shopId);

  // If there's no revenue, the margin is 0 to avoid division by zero
  if (totalRevenue === 0) {
    return 0;
  }

  // Now, calculate the Total Cost of Goods Sold (COGS)
  const cogsResult = await db('historical_sales as hs')
    .join('product_costs as pc', 'hs.sku', 'pc.sku')
    .where('hs.shop_id', shopId)
    .sum({ total: db.raw('hs.quantity_sold * pc.landed_cost_per_unit') })
    .first();

  const totalCogs = cogsResult && cogsResult.total ? parseFloat(cogsResult.total as string) : 0;

  const grossProfit = totalRevenue - totalCogs;
  const grossMarginPercentage = (grossProfit / totalRevenue) * 100;

  return grossMarginPercentage;
}