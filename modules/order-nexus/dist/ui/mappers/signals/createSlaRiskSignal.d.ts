/**
 * SLA Risk Signal Builder
 * -----------------------
 *
 * Constructs the operational signal representing
 * orders approaching fulfillment SLA breach.
 *
 * This module only builds the signal object.
 * Lifecycle, detection timestamps, and ordering
 * remain managed by the signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
export declare function createSlaRiskSignal(snapshot: {
    orders_at_sla_risk: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string): OperationalSignal;
