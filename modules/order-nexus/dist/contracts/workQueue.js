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
export {};
//# sourceMappingURL=workQueue.js.map