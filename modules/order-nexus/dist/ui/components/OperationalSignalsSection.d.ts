import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import type { WorkQueueItem } from '../../contracts/workQueue.js';
export interface OperationalSignalsSectionProps {
    signals: OperationalSignal[];
    queues: WorkQueueItem[];
    onSignalAction?: (actionType: string, signal: OperationalSignal) => void;
    onQueueAction?: (actionType: string, queue: WorkQueueItem) => void;
}
/**
 * OPERATIONAL SIGNALS SURFACE
 * ---------------------------
 * Unified Control Tower surface rendering:
 *
 * - Operational incidents
 * - Operational workload queues
 *
 * All rendered using FT2SignalBanner.
 */
export declare function OperationalSignalsSection({ signals, queues, onSignalAction, onQueueAction }: OperationalSignalsSectionProps): import("react").JSX.Element;
