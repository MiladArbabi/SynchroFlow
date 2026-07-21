/**
 * Payment Review Signal Builder
 * -----------------------------
 *
 * Constructs the operational signal representing
 * orders awaiting manual payment verification.
 *
 * Lifecycle, severity escalation, and ordering
 * are handled by the signal engine.
 */
export function createPaymentReviewSignal(snapshot, detectedAt, lifecycle, severity, signalId) {
    return {
        id: signalId,
        severity,
        detectedAt,
        lifecycle,
        title: 'Payment review',
        impact: snapshot.queue_manual_review === 1
            ? '1 order awaiting verification'
            : `${snapshot.queue_manual_review} orders awaiting verification`,
        metadata: {
            queue: 'manual_review',
            affectedOrders: snapshot.queue_manual_review,
        },
        actions: [
            {
                id: 'review_payments',
                label: 'Review orders',
                actionType: 'open_manual_review_orders',
            },
        ],
    };
}
//# sourceMappingURL=createPaymentReviewSignal.js.map