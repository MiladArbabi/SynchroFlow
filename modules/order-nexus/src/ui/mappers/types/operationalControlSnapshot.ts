/**
 * Operational Control Snapshot
 * ----------------------------
 *
 * Canonical snapshot contract used by the
 * Operational Signals engine.
 *
 * This file exists to prevent circular imports
 * between mapper layers.
 */

export type OperationalControlSnapshot = {
  queue_manual_review: number;
  queue_awaiting_inventory: number;
  queue_ready_to_ship: number;
  queue_awaiting_customer: number;
  orders_at_sla_risk: number;
  pending_fulfillment: number;
  
  aging_24h: number;
  aging_48h: number;
  aging_72h_plus: number;

  exception_orders: number;
  pending_payment: number;
  at_risk_revenue: number;
  constrained_orders: number;
  partial_fulfillment_opportunity: number;

  /* revenue exposure */
  revenue_blocked_inventory: number
  revenue_blocked_customer: number
  revenue_blocked_operational: number
};