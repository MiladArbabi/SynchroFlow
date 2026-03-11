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
 * Detection registry
 */
const signalDetectionRegistry = new Map<string, string>();

/**
 * Lifecycle state registry
 */
const signalLifecycleRegistry =
  new Map<string, OperationalSignalLifecycle>();

/**
 * Resolution registry
 */
const signalResolvedAtRegistry =
  new Map<string, number>();

/**
 * Track active signals during a snapshot cycle.
 */
export function registerSignalType(
  activeSignalTypes: Set<string>,
  normalizedType: string
): boolean {

  if (activeSignalTypes.has(normalizedType)) {
    return false;
  }

  activeSignalTypes.add(normalizedType);
  return true;
}

/**
 * Get detection timestamp for signal.
 */
export function getDetectedAt(
  key: string,
  evaluationTime: number
): string {

  if (!signalDetectionRegistry.has(key)) {
    /**
     * Deterministic detection timestamp
     * ---------------------------------
     * Must originate from the snapshot evaluation cycle.
     * Wall-clock time is forbidden because signals must
     * be reproducible from projection state.
     */
    signalDetectionRegistry.set(
      key,
      new Date(evaluationTime).toISOString()
    );
  }

  return signalDetectionRegistry.get(key)!;
}

/**
 * Retrieve lifecycle state.
 */
export function getLifecycle(
  key: string
): OperationalSignalLifecycle {

  if (!signalLifecycleRegistry.has(key)) {
    signalLifecycleRegistry.set(key, 'NEW');
  }

  return signalLifecycleRegistry.get(key)!;
}

/**
 * Update lifecycle state.
 */
export function updateSignalLifecycle(
  key: string,
  lifecycle: OperationalSignalLifecycle
) {

  const current =
    signalLifecycleRegistry.get(key);

  const order = {
    NEW: 1,
    ACKNOWLEDGED: 2,
    IN_PROGRESS: 3,
    RESOLVED: 4,
  };

  if (!current || order[lifecycle] >= order[current]) {
    signalLifecycleRegistry.set(key, lifecycle);
  }
}

/**
 * Resolve signals that disappeared from snapshot.
 */
export function resolveInactiveSignals(
  activeSignalTypes: Set<string>,
  evaluationTime: number
) {

  for (const key of signalDetectionRegistry.keys()) {

    if (!activeSignalTypes.has(key)) {

      signalLifecycleRegistry.set(key, 'RESOLVED');
      signalResolvedAtRegistry.set(key, evaluationTime);

      signalDetectionRegistry.delete(key);
    }
  }
}

/**
 * Cleanup resolved signals after retention window.
 */
export function pruneResolvedSignals(
  evaluationTime: number,
  retentionMs: number
): number {

  let pruned = 0;

  for (const [key, resolvedAt] of signalResolvedAtRegistry.entries()) {

    if (evaluationTime - resolvedAt > retentionMs) {

      signalResolvedAtRegistry.delete(key);
      signalLifecycleRegistry.delete(key);

      pruned++;
    }

  }

  return pruned;
}