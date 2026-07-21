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
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
export function createPaymentProblemSignal(snapshot, detectedAt, lifecycle, severity, signalId, currency) {
    return {
        id: signalId,
        severity,
        detectedAt,
        lifecycle,
        title: 'Payment retry required',
        impact: snapshot.pending_payment === 1
            ? '1 order requires payment retry'
            : `${snapshot.pending_payment} orders require payment retry`,
        /**
         * Financial exposure
         * ------------------
         * Revenue at risk from unpaid orders.
         */
        impactDetail: snapshot.at_risk_revenue > 0
            ? `${formatCurrencyCompact(snapshot.at_risk_revenue, currency?.displayCurrency, currency?.locale, currency?.rates)} revenue at risk`
            : undefined,
        metadata: {
            pending_payment: snapshot.pending_payment,
        },
        actions: [
            {
                id: 'review_payment_orders',
                label: 'Review orders',
                actionType: 'review_payment_orders',
            },
        ],
        batchActions: [
            {
                id: 'contact_customer_payment',
                label: 'Contact customer',
                actionType: 'contact_customer_payment',
            },
        ],
    };
}
//# sourceMappingURL=createPaymentProblemSignal.js.map