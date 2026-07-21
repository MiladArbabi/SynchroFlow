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
export function getSignalIcon(severity) {
    switch (severity) {
        case 'critical':
            return '🚨';
        case 'warning':
            return '⚠️';
        case 'info':
        default:
            return 'ℹ️';
    }
}
/**
 * Optional severity priority.
 * Useful for queue ordering.
 */
export function getSeverityPriority(severity) {
    switch (severity) {
        case 'critical':
            return 1;
        case 'warning':
            return 2;
        case 'info':
        default:
            return 3;
    }
}
//# sourceMappingURL=signalSeverity.js.map