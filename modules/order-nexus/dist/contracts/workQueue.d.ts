/**
 * Work Queue Contract
 * -------------------
 * Defines the UI data surface for operational workload queues.
 *
 * Architectural rule:
 *   Signals → operational problems
 *   Queues  → operational workload
 *
 * Queues originate from the reconciliation projection
 * `orders_operational_control_snapshot`.
 *
 * IMPORTANT:
 * - No runtime computation
 * - No aggregation
 * - Strict projection passthrough
 */
export interface WorkQueueItem {
    /**
     * Stable identifier used by UI and routing.
     * Must remain deterministic across rebuilds.
     */
    id: string;
    /**
     * Human-readable queue label displayed in UI.
     */
    title: string;
    /**
     * Deterministic count originating from
     * `orders_operational_control_snapshot`.
     */
    count: number;
    /**
     * Short operational description shown in the UI.
     */
    description: string;
    /**
     * Optional operator actions triggered from queue row.
     * Example: navigate to filtered orders view.
     */
    actions?: WorkQueueAction[];
}
export interface WorkQueueAction {
    id: string;
    label: string;
    intent: string;
}
