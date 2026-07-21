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
/**
 * Detection registry
 */
const signalDetectionRegistry = new Map();
/**
 * Resolution registry
 */
const signalResolvedAtRegistry = new Map();
/**
 * Track active signals during a snapshot cycle.
 */
export function registerSignalType(activeSignalTypes, normalizedType) {
    if (activeSignalTypes.has(normalizedType)) {
        return false;
    }
    activeSignalTypes.add(normalizedType);
    return true;
}
/**
 * Get detection timestamp for signal.
 */
export function getDetectedAt(key, evaluationTime) {
    if (!signalDetectionRegistry.has(key)) {
        /**
         * Deterministic detection timestamp
         * ---------------------------------
         * Must originate from the snapshot evaluation cycle.
         * Wall-clock time is forbidden because signals must
         * be reproducible from projection state.
         */
        signalDetectionRegistry.set(key, new Date(evaluationTime).toISOString());
    }
    return signalDetectionRegistry.get(key);
}
/**
 * Deterministic lifecycle state
 *
 * Lifecycle must derive exclusively from
 * projection snapshot presence.
 *
 * If the signal exists in the snapshot,
 * it is considered NEW.
 */
export function getLifecycle() {
    return 'NEW';
}
;
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
export function updateSignalLifecycle(signalId, lifecycle) {
    if (typeof window !== 'undefined') {
        console.info('[OperationalSignals] lifecycle transition requested', {
            signalId,
            lifecycle,
        });
    }
}
//# sourceMappingURL=signalLifecycleEngine.js.map