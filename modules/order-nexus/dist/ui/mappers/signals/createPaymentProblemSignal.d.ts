/**
 * Payment Problem Signal Builder
 * ------------------------------
 *
 * Constructs the operational signal representing
 * orders requiring payment retry due to failed
 * or incomplete payment attempts.
 *
 * Lifecycle, escalation, and queue ordering
 * remain handled by the signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export declare function createPaymentProblemSignal(snapshot: {
    pending_payment: number;
    at_risk_revenue: number;
    revenue_blocked_customer: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string, currency?: CurrencyContext): OperationalSignal;
