/**
 * Operational State Detection
 * ---------------------------
 *
 * Converts raw snapshot metrics into high-level
 * operational states used by the signal engine.
 *
 * IMPORTANT
 * ---------
 * This layer performs NO signal construction.
 *
 * Responsibilities:
 * - Interpret snapshot metrics
 * - Detect operational situations
 * - Return deterministic state flags
 *
 * This enables the signal engine to operate on
 * state clusters instead of individual metrics.
 */
/**
 * Detect operational states from snapshot metrics.
 *
 * This function must remain deterministic.
 * No time-based logic or side effects allowed.
 */
export function detectOperationalStates(snapshot) {
    return {
        inventoryConstraintCluster: snapshot.queue_awaiting_inventory > 0 ||
            snapshot.constrained_orders > 0 ||
            snapshot.partial_fulfillment_opportunity > 0,
        slaRisk: snapshot.orders_at_sla_risk > 0,
        paymentReview: snapshot.queue_manual_review > 0,
        paymentProblem: snapshot.pending_payment > 0,
        agingOrders: snapshot.aging_48h > 0 ||
            snapshot.aging_72h_plus > 0,
        operationalException: snapshot.exception_orders > 0,
        awaitingCustomer: snapshot.queue_awaiting_customer > 0,
        /**
          * NOTE:
          * Snapshot field is `aging_under_24h`
          * (normalized at projection layer)
          */
        earlyAging: snapshot.aging_24h > 0
    };
}
//# sourceMappingURL=detectOperationalStates.js.map