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
import type { WorkQueueItem } from '../../contracts/workQueue.js';
import type { OperationalControlSnapshot } from './types/operationalControlSnapshot.js';
export declare function mapWorkQueues(snapshot: OperationalControlSnapshot): WorkQueueItem[];
