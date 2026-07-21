/**
 * Aging Signal Builders
 * ---------------------
 *
 * Constructs operational signals representing
 * orders aging beyond normal fulfillment windows.
 *
 * Two escalation stages exist:
 *
 * 24h  → early warning
 * 48h+ → critical intervention
 *
 * Lifecycle, severity escalation, and ordering
 * remain managed by the signal engine.
 */
import type { OperationalSignal, OperationalSignalLifecycle, OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
/**
 * Early Aging Signal (24h)
 */
export declare function createEarlyAgingSignal(snapshot: {
    aging_24h: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string): OperationalSignal;
/**
 * Critical Aging Signal (>48h)
 */
export declare function createAgingOrdersSignal(snapshot: {
    aging_48h: number;
    aging_72h_plus: number;
}, detectedAt: string, lifecycle: OperationalSignalLifecycle, severity: OperationalSignalSeverity, signalId: string): OperationalSignal;
