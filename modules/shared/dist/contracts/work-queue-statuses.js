/**
 * Canonical "still open" status sets for operator work queues.
 *
 * WHY THIS FILE EXISTS: each surface that counted open work previously typed
 * its own status list inline, and they drifted. Two live defects came from it:
 *
 *   RECEIVE-ACTIVE-UNDERCOUNT-45 — OrdersInboundPage counted only
 *     pending/in_progress, so a receive job in inspection, barcode_assignment
 *     or stow_ready read as inactive while sitting open on the floor.
 *   WMS-STOWCOUNT-43 — httpScanResolve counts pending + in_progress stow
 *     tasks, stowPressure counts pending only. Same concept, two numbers.
 *
 * A work item is OPEN from the moment it exists until it reaches a terminal
 * state. Open does NOT mean unclaimed: an item an operator has already
 * claimed is still open work on the floor, and a queue that dropped it on
 * claim would go quiet while the work sat half-finished.
 *
 * Adding an enum member? Add it here, or every counter silently excludes it.
 */
/**
 * receive_job_status has 7 members; closed and cancelled are the only
 * terminal ones. This five-member set is the same one the backend's own
 * create-guard uses to detect an existing open job for a PO
 * (receiveJob.controller.ts) — named here rather than retyped.
 */
export const RECEIVE_JOB_OPEN_STATUSES = [
    'pending',
    'in_progress',
    'inspection',
    'barcode_assignment',
    'stow_ready',
];
/**
 * A stow task is open until it is completed or cancelled. in_progress is
 * included deliberately — see WMS-STOWCOUNT-43 above.
 */
export const STOW_TASK_OPEN_STATUSES = [
    'pending',
    'in_progress',
];
