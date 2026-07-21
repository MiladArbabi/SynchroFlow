/**
 * Signal Ordering
 * ----------------
 *
 * Deterministic ordering for the Operations Queue.
 *
 * Priority rules:
 *
 * 1. severity
 * 2. signal age
 * 3. deterministic id
 */
export function sortOperationalSignals(signals) {
    const severityPriority = {
        critical: 1,
        warning: 2,
        info: 3,
    };
    signals.sort((a, b) => {
        const severityDiff = severityPriority[a.severity] -
            severityPriority[b.severity];
        if (severityDiff !== 0) {
            return severityDiff;
        }
        /**
         * Deterministic ordering fallback
         * --------------------------------
         * Signal age cannot be derived from runtime timestamps
         * because the operational signal engine must remain
         * reproducible from projection state.
         *
         * Therefore ordering falls back directly to the
         * deterministic signal identifier.
         */
        return a.id.localeCompare(b.id);
    });
    return signals;
}
//# sourceMappingURL=sortOperationalSignals.js.map