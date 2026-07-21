/**
 * Work Queue Mapper
 * -----------------
 * Converts operational snapshot workload metrics
 * into deterministic UI queue items.
 *
 * Architectural rules:
 * - No computation
 * - No aggregation
 * - Strict projection passthrough
 *
 * Source of truth:
 * orders_operational_control_snapshot
 */
export function mapWorkQueues(snapshot) {
    /**
     * Only emit queues containing operational workload.
     *
     * Zero-count queues represent inactive workload surfaces
     * and must not be rendered in the operator dashboard.
     *
     * This filtering occurs in the mapper layer to keep the UI
     * rendering surface deterministic and logic-free.
     */
    return [
        {
            id: 'ready-to-ship',
            title: 'Ready to Ship',
            count: snapshot.queue_ready_to_ship,
            description: 'Orders ready for warehouse processing',
            actions: [
                {
                    id: 'view-ready-to-ship',
                    label: 'View Orders',
                    intent: 'orders.queue.ready_to_ship'
                }
            ]
        },
        {
            id: 'pending-fulfillment',
            title: 'Pending Fulfillment',
            count: snapshot.pending_fulfillment,
            description: 'Orders awaiting fulfillment execution',
            actions: [
                {
                    id: 'view-pending-fulfillment',
                    label: 'View Orders',
                    intent: 'orders.queue.pending_fulfillment'
                }
            ]
        },
        {
            id: 'awaiting-inventory',
            title: 'Awaiting Inventory',
            count: snapshot.queue_awaiting_inventory,
            description: 'Orders blocked due to insufficient inventory',
            actions: [
                {
                    id: 'view-awaiting-inventory',
                    label: 'View Orders',
                    intent: 'orders.queue.awaiting_inventory'
                }
            ]
        },
        {
            id: 'awaiting-customer',
            title: 'Awaiting Customer',
            count: snapshot.queue_awaiting_customer,
            description: 'Orders awaiting customer response or action',
            actions: [
                {
                    id: 'view-awaiting-customer',
                    label: 'View Orders',
                    intent: 'orders.queue.awaiting_customer'
                }
            ]
        },
        {
            id: 'manual-review',
            title: 'Manual Review',
            count: snapshot.queue_manual_review,
            description: 'Orders requiring manual operational review',
            actions: [
                {
                    id: 'view-manual-review',
                    label: 'Open Queue',
                    intent: 'orders.queue.manual_review'
                }
            ]
        }
    ].filter((queue) => queue.count > 0);
}
//# sourceMappingURL=mapWorkQueues.js.map