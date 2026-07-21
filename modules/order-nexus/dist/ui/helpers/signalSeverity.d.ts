/**
 * Signal Severity Helpers
 * -----------------------
 *
 * Centralizes UI rendering behavior for OperationalSignal severity.
 *
 * Responsibilities:
 * - icon rendering
 * - severity ordering
 * - future styling hooks
 */
import type { OperationalSignalSeverity } from '../../contracts/operationalSignals.js';
export declare function getSignalIcon(severity: OperationalSignalSeverity): string;
/**
 * Optional severity priority.
 * Useful for queue ordering.
 */
export declare function getSeverityPriority(severity: OperationalSignalSeverity): number;
