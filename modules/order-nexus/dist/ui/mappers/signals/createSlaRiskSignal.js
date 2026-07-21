export function createSlaRiskSignal(snapshot, detectedAt, lifecycle, severity, signalId) {
    return {
        id: signalId,
        severity,
        detectedAt,
        lifecycle,
        title: 'SLA risk',
        impact: snapshot.orders_at_sla_risk === 1
            ? '1 order nearing deadline'
            : `${snapshot.orders_at_sla_risk} orders nearing deadline`,
        metadata: {
            queue: 'sla_risk',
            affectedOrders: snapshot.orders_at_sla_risk,
        },
        actions: [
            {
                id: 'inspect_sla_orders',
                label: 'Review orders',
                actionType: 'open_sla_risk_orders',
            },
        ],
        batchActions: [
            {
                id: 'prioritize_orders',
                label: 'Prioritize fulfillment',
                actionType: 'prioritize_stuck_orders',
            },
        ],
    };
}
//# sourceMappingURL=createSlaRiskSignal.js.map