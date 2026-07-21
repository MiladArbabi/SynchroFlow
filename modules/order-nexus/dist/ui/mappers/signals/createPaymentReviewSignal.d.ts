/**
 * Payment Review Signal Builder
 * -----------------------------
 *
 * Constructs the operational signal representing
 * orders awaiting manual payment verification.
 *
 * Lifecycle, severity escalation, and ordering
 * are handled by the signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
export declare function createPaymentReviewSignal(snapshot: {
    queue_manual_review: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string): OperationalSignal;
