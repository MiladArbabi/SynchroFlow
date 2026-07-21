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
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
export function createOperationalExceptionSignal(snapshot, detectedAt, lifecycle, severity, signalId, currency) {
    return {
        id: signalId,
        severity,
        detectedAt,
        lifecycle,
        title: 'Operational exception detected',
        impact: snapshot.exception_orders === 1
            ? '1 order needs intervention'
            : `${snapshot.exception_orders} orders need intervention`,
        /**
         * Financial exposure
         * ------------------
         * Only emit impactDetail when revenue is actually at risk.
         *
         * If revenue = 0 we intentionally omit the field so the UI
         * falls back to operational aging context (oldest_waiting_hours).
         */
        impactDetail: snapshot.revenue_blocked_operational > 0
            ? `${formatCurrencyCompact(snapshot.revenue_blocked_operational, currency?.displayCurrency, currency?.locale, currency?.rates)} revenue at risk`
            : undefined,
        metadata: {
            exception_orders: snapshot.exception_orders,
            /**
             * Oldest waiting order age
             * ------------------------
             * Derives urgency context from aging buckets.
             *
             * IMPORTANT
             * If exception orders exist but none fall into
             * aging buckets, the snapshot is inconsistent.
             *
             * We surface 24h as a deterministic lower bound
             * and emit a console warning to prevent silent
             * operational blindness.
             */
            oldest_waiting_hours: snapshot.aging_72h_plus > 0
                ? 72
                : snapshot.aging_48h > 0
                    ? 48
                    : snapshot.aging_24h > 0
                        ? 24
                        : snapshot.exception_orders > 0
                            ? (console.warn('[OperationalSignals] Exception orders detected without aging bucket coverage', snapshot), 24)
                            : 0
        },
        actions: [
            {
                id: 'inspect_exception_orders',
                label: 'Inspect orders',
                actionType: 'inspect_exception_orders',
            },
        ],
        batchActions: [
            {
                id: 'contact_warehouse',
                label: 'Contact warehouse',
                actionType: 'contact_warehouse',
            },
        ],
    };
}
//# sourceMappingURL=createOperationalExceptionSignal.js.map