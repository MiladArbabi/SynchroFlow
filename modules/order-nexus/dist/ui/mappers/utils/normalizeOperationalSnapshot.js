/**
 * Snapshot Normalization
 * ----------------------
 *
 * Ensures snapshot metrics are:
 * - numeric
 * - non-negative
 * - within operational bounds
 *
 * Prevents malformed resolver input from
 * corrupting the operational signal engine.
 */
import { safeMetric, warnOnce } from './signalUtils.js';
/**
 * Metric warning registry
 * -----------------------
 * Tracks previously emitted metric anomalies so we
 * avoid repeating identical warnings across snapshot
 * refresh cycles.
 *
 * Module-scope by design.
 */
const metricWarningRegistry = new Set();
/**
 * Warning adapter
 * ---------------
 * Bridges mapper-local warning registry with
 * shared warnOnce utility.
 */
const warn = (key, message, payload) => {
    warnOnce(metricWarningRegistry, key, message, payload);
};
export function normalizeOperationalSnapshot(snapshot) {
    return {
        snapshot_date: snapshot.snapshot_date,
        queue_manual_review: safeMetric(snapshot.queue_manual_review, warn),
        queue_awaiting_inventory: safeMetric(snapshot.queue_awaiting_inventory, warn),
        queue_ready_to_ship: safeMetric(snapshot.queue_ready_to_ship, warn),
        queue_awaiting_customer: safeMetric(snapshot.queue_awaiting_customer, warn),
        orders_at_sla_risk: safeMetric(snapshot.orders_at_sla_risk, warn),
        pending_fulfillment: safeMetric(snapshot.pending_fulfillment, warn),
        aging_24h: safeMetric(snapshot.aging_24h, warn),
        aging_48h: safeMetric(snapshot.aging_48h, warn),
        aging_72h_plus: safeMetric(snapshot.aging_72h_plus, warn),
        exception_orders: safeMetric(snapshot.exception_orders, warn),
        constrained_orders: safeMetric(snapshot.constrained_orders, warn),
        pending_payment: safeMetric(snapshot.pending_payment, warn),
        at_risk_revenue: safeMetric(snapshot.at_risk_revenue, warn),
        /**
         * COMMAND CENTER — PRIMARY METRICS
         * --------------------------------
         * Must remain aligned with backend snapshot contract.
         * Prevents silent field drift between BE and UI.
         */
        total_at_risk_revenue: safeMetric(snapshot.total_at_risk_revenue, warn),
        sla_breach_24h_revenue: safeMetric(snapshot.sla_breach_24h_revenue, warn),
        // categorical → no numeric normalization
        top_blocking_type: snapshot.top_blocking_type ?? 'none',
        partial_fulfillment_opportunity: safeMetric(snapshot.partial_fulfillment_opportunity, warn),
        revenue_blocked_inventory: safeMetric(snapshot.revenue_blocked_inventory, warn),
        revenue_blocked_customer: safeMetric(snapshot.revenue_blocked_customer, warn),
        revenue_blocked_operational: safeMetric(snapshot.revenue_blocked_operational, warn)
    };
}
//# sourceMappingURL=normalizeOperationalSnapshot.js.map