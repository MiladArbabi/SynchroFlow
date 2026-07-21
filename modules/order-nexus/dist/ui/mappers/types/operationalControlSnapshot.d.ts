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
    /**
     * Projection snapshot timestamp
     *
     * Deterministic evaluation anchor for
     * operational signal lifecycle.
     *
     * MUST originate from the reconciliation projection.
     */
    snapshot_date: string;
    queue_manual_review: number;
    queue_awaiting_inventory: number;
    queue_ready_to_ship: number;
    queue_awaiting_customer: number;
    orders_at_sla_risk: number;
    pending_fulfillment: number;
    /**
     * AGING BUCKETS
     * -------------
     * Must align with signal engine expectations.
     */
    aging_24h: number;
    aging_48h: number;
    aging_72h_plus: number;
    exception_orders: number;
    pending_payment: number;
    at_risk_revenue: number;
    /**
     * COMMAND CENTER — PRIMARY METRICS
     * --------------------------------
     * Backend-computed. Source of truth.
     */
    total_at_risk_revenue: number;
    sla_breach_24h_revenue: number;
    top_blocking_type: string;
    constrained_orders: number;
    partial_fulfillment_opportunity: number;
    revenue_blocked_inventory: number;
    revenue_blocked_customer: number;
    revenue_blocked_operational: number;
};
