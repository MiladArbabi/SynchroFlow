/**
 * METRIC CONTRACT — SNAPSHOT SYSTEM
 * ---------------------------------
 * Single source of truth for all computed metrics.
 * Any change MUST be reflected here.
 */
export type SnapshotMetrics = {
  realizedRevenue: number;
  pendingRevenue: number;
  atRiskRevenue: number;

  revenueBlockedInventory: number;
  revenueBlockedCustomer: number;
  revenueBlockedOperational: number;
  blockedRevenueTotal: number;

  avgContributionMarginPct: number;

  pendingFulfillment: number;
  exceptionOrders: number;
  constrainedOrders: number;

  aging24h: number;
  aging48h: number;
  aging72hPlus: number;

  ordersAtSlaRisk: number;
  slaBreach24hRevenue: number;

  queueManualReview: number;
  queueAwaitingInventory: number;
  queueAwaitingCustomer: number;
  queueReadyToShip: number;

  readyToShipRevenue: number;

  fulfilledOrders: number;

  oldestExceptionOrderAgeHours: number;
  revenueLeakage: number;

  aggregateVersion: number;
};