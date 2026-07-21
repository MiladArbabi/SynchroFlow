/**
 * Operational Exception Signal Builder
 * ------------------------------------
 *
 * Constructs the operational signal representing
 * fulfillment or processing anomalies detected
 * by the reconciliation projection.
 *
 * Lifecycle, escalation, and ordering are handled
 * by the main signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export declare function createOperationalExceptionSignal(snapshot: {
    exception_orders: number;
    revenue_blocked_operational: number;
    aging_24h: number;
    aging_48h: number;
    aging_72h_plus: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string, currency?: CurrencyContext): OperationalSignal;
