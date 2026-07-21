/**
 * Signal Utility Helpers
 * ----------------------
 *
 * Shared helpers used by the operational
 * signal engine.
 *
 * These utilities are intentionally stateless
 * and deterministic.
 */
import type { OperationalSignalSeverity } from '../../../contracts/operationalSignals.js';
/**
 * Generate deterministic signal ID namespace.
 */
export declare function signalId(type: string): string;
/**
 * Prevent log spam by warning only once per key.
 */
export declare function warnOnce(registry: Set<string>, key: string, message: string, payload: unknown, maxSize?: number): void;
/**
 * Normalize snapshot metric values.
 */
export declare function safeMetric(value: unknown, warn: (key: string, message: string, payload: unknown) => void, maxValue?: number): number;
/**
 * Deterministic severity escalation
 * ---------------------------------
 *
 * Operational signals must not depend on wall-clock time.
 * Severity escalation must therefore be driven by
 * projection metrics or explicit lifecycle transitions.
 *
 * Current behavior:
 * - Pass-through severity
 * - Lifecycle engine responsible for escalation in future
 *
 * This preserves deterministic rebuild guarantees.
 */
export declare function escalateSeverity(severity: OperationalSignalSeverity, _detectedAt: string, _evaluationTime: number): OperationalSignalSeverity;
