export const demandRealityPlane = {
    planeId: 'demand-reality',
    compute(input) {
        const { customers, orders } = input;
        // Visibility gate (hard)
        if (customers.visibility !== 'sufficient' ||
            orders.visibility !== 'sufficient') {
            return 'unknown';
        }
        const { engagementTrend } = customers;
        const { trend, outcome } = orders;
        // Missing signals
        if (!engagementTrend || !trend || !outcome) {
            return 'unknown';
        }
        // Outcome breaker
        if (outcome === 'negative') {
            return 'divergent';
        }
        // Alignment logic
        if (engagementTrend === 'up' && trend === 'up') {
            return 'aligned';
        }
        if (engagementTrend === 'flat' && trend === 'up') {
            return 'aligned';
        }
        if (engagementTrend === 'up' && trend !== 'up') {
            return 'divergent';
        }
        if (engagementTrend === 'down' && trend === 'up') {
            return 'divergent';
        }
        return 'unknown';
    },
};
