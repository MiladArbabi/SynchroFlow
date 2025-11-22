// packages/api/src/services/customer-resolution.service.ts
import db from '../db';

export const resolveCustomerMetrics = async (shopId: number) => {
  try {
    // Calculate customer metrics from orders
    const customerMetrics = await db('orders')
      .select(
        'platform_customer_id',
        db.raw('COUNT(*) as total_orders'),
        db.raw('SUM(total_price) as total_spent')
      )
      .where('shop_id', shopId)
      .whereNotNull('platform_customer_id')
      .groupBy('platform_customer_id');

    // Update customers table with calculated metrics
    for (const metric of customerMetrics) {
      await db('customers')
        .where({
          shop_id: shopId,
          platform_customer_id: metric.platform_customer_id
        })
        .update({
          total_orders: metric.total_orders,
          total_spent: metric.total_spent
        });
    }

    console.log(`[CustomerResolution] Updated metrics for ${customerMetrics.length} customers`);
  } catch (error) {
    console.error('[CustomerResolution] Error resolving customer metrics:', error);
  }
};