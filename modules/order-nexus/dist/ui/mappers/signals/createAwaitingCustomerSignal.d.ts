/**
 * Awaiting Customer Signal Builder
 * --------------------------------
 *
 * Constructs the operational signal representing
 * orders blocked because customer action is required.
 *
 * Lifecycle, escalation, and ordering remain
 * controlled by the signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
export declare function createAwaitingCustomerSignal(snapshot: {
    queue_awaiting_customer: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string): OperationalSignal;
