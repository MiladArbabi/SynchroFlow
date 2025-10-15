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

export async function getInventoryHealth(shopId: number): Promise<any[]> {
  const inventoryItems = await db('inventory_truth')
    .where({ shop_id: shopId })
    .select('sku', 'quantity_available');

  // Map over the items to add a 'status' based on our business rules
  const itemsWithStatus = inventoryItems.map(item => {
    let status: string;
    if (item.quantity_available > 10) {
      status = 'Healthy';
    } else if (item.quantity_available > 0 && item.quantity_available <= 10) {
      status = 'At Risk';
    } else {
      status = 'Stockout';
    }
    return { ...item, status };
  });

  return itemsWithStatus;
}

export async function calculateCostOfStockout(shopId: number, sku: string): Promise<number> {
  // 1. Calculate Daily Sales Velocity
  const salesStats = await db('historical_sales')
    .where({ shop_id: shopId, sku: sku })
    .select(
      db.raw('SUM(quantity_sold) as total_sold'),
      db.raw('COUNT(DISTINCT sale_date::date) as days_of_sales')
    )
    .first();

  // If there are no sales, the stockout cost is zero.
  if (!salesStats || !salesStats.total_sold || Number(salesStats.days_of_sales) === 0) {
    return 0;
  }

  const dailyVelocity = Number(salesStats.total_sold) / Number(salesStats.days_of_sales);

  // 2. Calculate Profit Per Unit
  const productInfo = await db('inventory_truth as it')
    .leftJoin('product_costs as pc', 'it.sku', 'pc.sku')
    .where('it.shop_id', shopId)
    .andWhere('it.sku', sku)
    .select('it.price', 'pc.landed_cost_per_unit')
    .first();

  // If we're missing price or cost data, we can't calculate profit.
  if (!productInfo || productInfo.price == null || productInfo.landed_cost_per_unit == null) {
    return 0;
  }

  const profitPerUnit = Number(productInfo.price) - Number(productInfo.landed_cost_per_unit);

  // 3. Hardcoded Lead Time (as per requirements)
  const leadTimeInDays = 14;

  // Final Calculation
  const costOfStockout = dailyVelocity * leadTimeInDays * profitPerUnit;

  return costOfStockout;
}