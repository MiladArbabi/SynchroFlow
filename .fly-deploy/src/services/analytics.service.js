"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateGrossRevenue = calculateGrossRevenue;
exports.calculateGrossMargin = calculateGrossMargin;
exports.getInventoryHealth = getInventoryHealth;
exports.calculateCostOfStockout = calculateCostOfStockout;
exports.getFulfillmentPipeline = getFulfillmentPipeline;
exports.calculatePerfectOrderPercentage = calculatePerfectOrderPercentage;
//packages/api/src/services/analytics.service.ts
const db_1 = __importDefault(require("../db"));
async function calculateGrossRevenue(shopId) {
    const result = await (0, db_1.default)('historical_sales as hs')
        .join('inventory_truth as it', 'hs.sku', 'it.sku')
        .where('hs.shop_id', shopId)
        .sum({ total: db_1.default.raw('hs.quantity_sold * it.price') })
        .first();
    // The result of a sum is a string by default, so we parse it to a float.
    // If there are no sales, the result will be null, so we default to 0.
    return result && result.total ? parseFloat(result.total) : 0;
}
async function calculateGrossMargin(shopId) {
    // We can reuse the function we already built to get total revenue
    const totalRevenue = await calculateGrossRevenue(shopId);
    // If there's no revenue, the margin is 0 to avoid division by zero
    if (totalRevenue === 0) {
        return 0;
    }
    // Now, calculate the Total Cost of Goods Sold (COGS)
    const cogsResult = await (0, db_1.default)('historical_sales as hs')
        .join('product_costs as pc', 'hs.sku', 'pc.sku')
        .where('hs.shop_id', shopId)
        .sum({ total: db_1.default.raw('hs.quantity_sold * pc.landed_cost_per_unit') })
        .first();
    const totalCogs = cogsResult && cogsResult.total ? parseFloat(cogsResult.total) : 0;
    const grossProfit = totalRevenue - totalCogs;
    const grossMarginPercentage = (grossProfit / totalRevenue) * 100;
    return grossMarginPercentage;
}
async function getInventoryHealth(shopId) {
    const inventoryItems = await (0, db_1.default)('inventory_truth')
        .where({ shop_id: shopId })
        .select('sku', 'quantity_available');
    // Map over the items to add a 'status' based on our business rules
    const itemsWithStatus = inventoryItems.map(item => {
        let status;
        if (item.quantity_available > 10) {
            status = 'Healthy';
        }
        else if (item.quantity_available > 0 && item.quantity_available <= 10) {
            status = 'At Risk';
        }
        else {
            status = 'Stockout';
        }
        return { ...item, status };
    });
    return itemsWithStatus;
}
async function calculateCostOfStockout(shopId, sku) {
    // 1. Calculate Daily Sales Velocity
    const salesStats = await (0, db_1.default)('historical_sales')
        .where({ shop_id: shopId, sku: sku })
        .select(db_1.default.raw('SUM(quantity_sold) as total_sold'), db_1.default.raw('COUNT(DISTINCT sale_date::date) as days_of_sales'))
        .first();
    // If there are no sales, the stockout cost is zero.
    if (!salesStats || !salesStats.total_sold || Number(salesStats.days_of_sales) === 0) {
        return 0;
    }
    const dailyVelocity = Number(salesStats.total_sold) / Number(salesStats.days_of_sales);
    // 2. Calculate Profit Per Unit
    const productInfo = await (0, db_1.default)('inventory_truth as it')
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
async function getFulfillmentPipeline(shopId) {
    const statusCounts = await (0, db_1.default)('order_fulfillment_status')
        .where({ shop_id: shopId })
        .groupBy('status')
        .select('status', db_1.default.raw('count(*)::int as count'));
    // The query returns an array like [{ status: 'processing', count: 2 }].
    // We need to transform it into the object { processing: 2 }.
    const pipeline = statusCounts.reduce((acc, row) => {
        // We don't include 'cancelled' orders in the pipeline view.
        if (row.status !== 'cancelled') {
            acc[row.status] = row.count;
        }
        return acc;
    }, {});
    // Ensure all keys are present, even if their count is 0
    const defaults = { processing: 0, in_transit: 0, delivered: 0 };
    return { ...defaults, ...pipeline };
}
async function calculatePerfectOrderPercentage(shopId) {
    // Count all delivered orders
    const totalOrdersResult = await (0, db_1.default)('order_fulfillment_status')
        .where({ shop_id: shopId, status: 'delivered' })
        .count({ total: 'id' })
        .first();
    const totalOrders = Number(totalOrdersResult?.total || 0);
    if (totalOrders === 0) {
        return 100; // If there are no orders, the percentage is perfect by default.
    }
    // Count delivered orders that had no issues
    const perfectOrdersResult = await (0, db_1.default)('order_fulfillment_status')
        .where({ shop_id: shopId, status: 'delivered', has_issue: false })
        .count({ total: 'id' })
        .first();
    const perfectOrders = Number(perfectOrdersResult?.total || 0);
    const percentage = (perfectOrders / totalOrders) * 100;
    return percentage;
}
