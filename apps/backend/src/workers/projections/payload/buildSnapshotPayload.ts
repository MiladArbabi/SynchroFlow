import type { SnapshotMetrics } from '../types/metrics.types.js';

/**
 * SNAPSHOT PAYLOAD BUILDER
 * ------------------------
 * Pure function.
 * No DB access. No side effects.
 */
export function buildSnapshotPayload(
  snapshotContext: {
    shopId: string;
    snapshotDateNormalized: string;
    snapshotDate: Date;
  },
  metrics: SnapshotMetrics
) {
  const {
    shopId,
    snapshotDateNormalized,
    snapshotDate,
  } = snapshotContext;

  const {
    realizedRevenue,
    pendingRevenue,
    atRiskRevenue,
    revenueBlockedInventory,
    revenueBlockedCustomer,
    revenueBlockedOperational,
    blockedRevenueTotal,
    avgContributionMarginPct,
    pendingFulfillment,
    exceptionOrders,
    constrainedOrders,
    aging24h,
    aging48h,
    aging72hPlus,
    ordersAtSlaRisk,
    slaBreach24hRevenue,
    queueManualReview,
    queueAwaitingInventory,
    queueAwaitingCustomer,
    queueReadyToShip,
    readyToShipRevenue,
    oldestExceptionOrderAgeHours,
    revenueLeakage,
    aggregateVersion,
    fulfilledOrders,
  } = metrics;

  const totalGMV =
    realizedRevenue +
    pendingRevenue +
    atRiskRevenue;

  let topBlockingType: 'inventory' | 'customer' | 'operational' = 'inventory';

  if (revenueBlockedCustomer >= revenueBlockedInventory && revenueBlockedCustomer >= revenueBlockedOperational) {
    topBlockingType = 'customer';
  } else if (revenueBlockedOperational >= revenueBlockedInventory) {
    topBlockingType = 'operational';
  }

  return {
    shop_id: shopId,
    snapshot_date: snapshotDateNormalized,
    aggregate_version: aggregateVersion,

    realized_revenue: realizedRevenue,
    pending_revenue: pendingRevenue,
    at_risk_revenue: atRiskRevenue,

    total_at_risk_revenue: atRiskRevenue,
    sla_breach_24h_revenue: slaBreach24hRevenue,
    top_blocking_type: topBlockingType,

    total_gmv: totalGMV,
    avg_contribution_margin_pct: avgContributionMarginPct,

    aging_24h: aging24h,
    aging_48h: aging48h,
    aging_72h_plus: aging72hPlus,

    revenue_blocked_inventory: revenueBlockedInventory,
    revenue_blocked_customer: revenueBlockedCustomer,
    revenue_blocked_operational: revenueBlockedOperational,
    blocked_revenue: blockedRevenueTotal,

    revenue_leakage: revenueLeakage,

    fulfilled_orders: fulfilledOrders,
    pending_fulfillment: pendingFulfillment,
    exception_orders: exceptionOrders,

    orders_at_sla_risk: ordersAtSlaRisk,
    constrained_orders: constrainedOrders,
    oldest_exception_order_age_hours: oldestExceptionOrderAgeHours,

    queue_manual_review: queueManualReview,
    queue_awaiting_inventory: queueAwaitingInventory,
    queue_awaiting_customer: queueAwaitingCustomer,
    queue_ready_to_ship: queueReadyToShip,
    ready_to_ship_revenue: readyToShipRevenue,

    evaluated_at: snapshotDate
  };
}