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
import type { OperationalSignal } from '../../../contracts/operationalSignals.js';
import type { OperationalControlSnapshot } from '../types/operationalControlSnapshot.js';
import type { OperationalSignalLifecycle } from '../../../contracts/operationalSignals.js';
import type { OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
export declare function createInventoryConstraintClusterSignal(snapshot: OperationalControlSnapshot, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, id: string): OperationalSignal;
