// apps/backend/src/services/customers/customerLtv.service.ts

import db from '@lasyncro/backend-core/db.js';

/**
 * CUSTOMER LTV SERVICE (CL-01, CL-02)
 * -------------------------------------
 * Computes lifetime value, order frequency, recency, and churn signal
 * from anonymous customer_hashed_id + order_revenue_units.
 *
 * PRIVACY RULES:
 * - No PII ever accessed or stored
 * - All computation on customer_hashed_id (SHA256, non-reversible)
 * - Guest checkouts excluded (null customer_hashed_id)
 *
 * SOURCES:
 * - orders.customer_hashed_id → customer identity
 * - order_revenue_units → revenue per order
 * - order_fulfillment_status → fulfilled vs pending
 * - refund_executions → refund history per customer
 *
 * RFM MODEL:
 * - Recency: days since last order
 * - Frequency: total order count
 * - Monetary: total lifetime revenue
 */

export type CustomerLtvRecord = {
  customer_hashed_id: string;
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last_order: number | null;
  total_refunds: number;
  net_revenue: number;
  churn_risk: 'low' | 'medium' | 'high';
  customer_tier: 'VIP' | 'CORE' | 'AT_RISK' | 'LOST' | 'NEW';
};

export type CustomerLtvSummary = {
  total_customers: number;
  avg_ltv: number;
  avg_order_frequency: number;
  avg_days_between_orders: number | null;
  vip_count: number;
  at_risk_count: number;
  lost_count: number;
};

export type CustomerLtvResult = {
  summary: CustomerLtvSummary;
  customers: CustomerLtvRecord[];
  computed_at: string;
};

/**
 * Derive churn risk from days since last order.
 */
function deriveChurnRisk(daysSinceLast: number | null): 'low' | 'medium' | 'high' {
  if (daysSinceLast === null) return 'high';
  if (daysSinceLast <= 30) return 'low';
  if (daysSinceLast <= 90) return 'medium';
  return 'high';
}

/**
 * Derive customer tier from order count, revenue, and recency.
 */
function deriveCustomerTier(
  totalOrders: number,
  totalRevenue: number,
  daysSinceLast: number | null
): 'VIP' | 'CORE' | 'AT_RISK' | 'LOST' | 'NEW' {
  if (daysSinceLast !== null && daysSinceLast > 180) return 'LOST';
  if (daysSinceLast !== null && daysSinceLast > 90) return 'AT_RISK';
  if (totalOrders === 1) return 'NEW';
  if (totalOrders >= 3 || totalRevenue >= 2000) return 'VIP';
  return 'CORE';
}

export async function computeCustomerLtv(
  shopId: number
): Promise<CustomerLtvResult> {
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    /**
     * PER-CUSTOMER AGGREGATES
     * -----------------------
     * Join orders → order_revenue_units for revenue.
     * Only registered customers (non-null customer_hashed_id).
     */
    const customerRows = await trx('orders as o')
      .join('order_revenue_units as oru', 'oru.lasyncro_order_id', 'o.lasyncro_order_id')
      .whereNotNull('o.customer_hashed_id')
      .where('o.shop_id', shopId)
      .groupBy('o.customer_hashed_id')
      .select(
        'o.customer_hashed_id',
        trx.raw('COUNT(DISTINCT o.lasyncro_order_id) as total_orders'),
        trx.raw('COALESCE(SUM(oru.line_total), 0) as total_revenue'),
        trx.raw('COALESCE(AVG(oru.line_total), 0) as avg_order_value'),
        trx.raw('MIN(o.order_created_at) as first_order_at'),
        trx.raw('MAX(o.order_created_at) as last_order_at'),
        trx.raw(`
          EXTRACT(DAY FROM NOW() - MAX(o.order_created_at))::int as days_since_last_order
        `),
      );

    /**
     * REFUNDS PER CUSTOMER
     * --------------------
     */
    const refundRows = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .whereNotNull('o.customer_hashed_id')
      .where('o.shop_id', shopId)
      .groupBy('o.customer_hashed_id')
      .select(
        'o.customer_hashed_id',
        trx.raw('COUNT(*) as refund_count'),
        trx.raw('COALESCE(SUM(re.total_refund_amount), 0) as total_refunded'),
      );

    const refundMap = new Map(
      refundRows.map((r: any) => [
        r.customer_hashed_id,
        { count: Number(r.refund_count), amount: Number(r.total_refunded) },
      ])
    );

    /**
     * BUILD PER-CUSTOMER RECORDS
     */
    const customers: CustomerLtvRecord[] = customerRows.map((row: any) => {
      const totalOrders = Number(row.total_orders);
      const totalRevenue = Number(row.total_revenue);
      const daysSinceLast = row.days_since_last_order != null
        ? Number(row.days_since_last_order)
        : null;
      const refundData = refundMap.get(row.customer_hashed_id);
      const totalRefunds = refundData?.count ?? 0;
      const netRevenue = totalRevenue - (refundData?.amount ?? 0);

      return {
        customer_hashed_id: row.customer_hashed_id,
        total_orders: totalOrders,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        avg_order_value: Math.round(Number(row.avg_order_value) * 100) / 100,
        first_order_at: row.first_order_at?.toISOString() ?? null,
        last_order_at: row.last_order_at?.toISOString() ?? null,
        days_since_last_order: daysSinceLast,
        total_refunds: totalRefunds,
        net_revenue: Math.round(netRevenue * 100) / 100,
        churn_risk: deriveChurnRisk(daysSinceLast),
        customer_tier: deriveCustomerTier(totalOrders, totalRevenue, daysSinceLast),
      };
    });

    /**
     * SHOP-LEVEL SUMMARY
     */
    const totalCustomers = customers.length;
    const avgLtv = totalCustomers > 0
      ? Math.round(customers.reduce((s, c) => s + c.total_revenue, 0) / totalCustomers * 100) / 100
      : 0;
    const avgOrderFrequency = totalCustomers > 0
      ? Math.round(customers.reduce((s, c) => s + c.total_orders, 0) / totalCustomers * 10) / 10
      : 0;

    const summary: CustomerLtvSummary = {
      total_customers: totalCustomers,
      avg_ltv: avgLtv,
      avg_order_frequency: avgOrderFrequency,
      avg_days_between_orders: null,
      vip_count: customers.filter(c => c.customer_tier === 'VIP').length,
      at_risk_count: customers.filter(c => c.customer_tier === 'AT_RISK').length,
      lost_count: customers.filter(c => c.customer_tier === 'LOST').length,
    };

    return {
      summary,
      customers: customers.sort((a, b) => b.total_revenue - a.total_revenue),
      computed_at: new Date().toISOString(),
    };
  });
}