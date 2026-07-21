/**
 * Signal Lifecycle Engine
 * -----------------------
 *
 * Manages operational signal lifecycle state,
 * detection timestamps, and duplicate detection.
 *
 * Responsibilities:
 *
 * - track signal detection timestamps
 * - manage lifecycle transitions
 * - prevent duplicate signal emission
 * - support lifecycle cleanup
 */
import type { OperationalSignalLifecycle } from '../../../contracts/operationalSignals.js';
/**
 * Track active signals during a snapshot cycle.
 */
export declare function registerSignalType(activeSignalTypes: Set<string>, normalizedType: string): boolean;
/**
 * Get detection timestamp for signal.
 */
export declare function getDetectedAt(key: string, evaluationTime: number): string;
/**
 * Deterministic lifecycle state
 *
 * Lifecycle must derive exclusively from
 * projection snapshot presence.
 *
 * If the signal exists in the snapshot,
 * it is considered NEW.
 */
export declare function getLifecycle(): OperationalSignalLifecycle;
/**
 * Lifecycle transition instrumentation
 * -----------------------------------
 * Lifecycle is no longer stored in UI memory.
 *
 * This function exists only to provide
 * operational instrumentation when actions
 * are triggered from the Control Tower.
 *
 * Real lifecycle progression must originate
 * from backend projections.
 */
export declare function updateSignalLifecycle(signalId: string, lifecycle: string): void;
