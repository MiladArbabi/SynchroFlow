/**
 * Inventory Constraint Cluster Signal
 * -----------------------------------
 *
 * Consolidates multiple inventory-related operational
 * states into a single actionable signal.
 *
 * Cluster sources:
 * - queue_awaiting_inventory
 * - constrained_orders
 * - partial_fulfillment_opportunity
 *
 * This prevents signal fragmentation in the operations queue.
 */
export function createInventoryConstraintClusterSignal(snapshot, detectedAt, lifecycle, severity, id) {
    const affectedOrders = snapshot.queue_awaiting_inventory +
        snapshot.constrained_orders +
        snapshot.partial_fulfillment_opportunity;
    /**
       * Signal contract alignment
       * -------------------------
       * Operational signals must strictly follow the
       * canonical OperationalSignal contract to ensure
       * UI compatibility and avoid schema drift.
       */
    return {
        id,
        lifecycle,
        detectedAt,
        severity,
        title: 'Inventory blocking order fulfillment',
        impact: `${affectedOrders} orders blocked by inventory constraints`,
        impactDetail: `${snapshot.queue_awaiting_inventory} awaiting inventory · ` +
            `${snapshot.constrained_orders} constrained · ` +
            `${snapshot.partial_fulfillment_opportunity} partial fulfillment opportunities`,
        metadata: {
            awaitingInventory: snapshot.queue_awaiting_inventory,
            constrainedOrders: snapshot.constrained_orders,
            partialFulfillmentOpportunity: snapshot.partial_fulfillment_opportunity
        }
    };
}
//# sourceMappingURL=createInventoryConstraintClusterSignal.js.map