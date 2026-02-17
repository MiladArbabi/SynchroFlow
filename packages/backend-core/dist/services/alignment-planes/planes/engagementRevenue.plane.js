export const engagementRevenuePlane = {
    planeId: 'engagement-revenue',
    compute({ customers, orders }) {
        if (customers.visibility !== 'sufficient' ||
            orders.visibility !== 'sufficient') {
            return 'unknown';
        }
        if (customers.engagementTrend === null ||
            orders.outcome === null) {
            return 'unknown';
        }
        if (customers.engagementTrend === 'flat') {
            return 'unknown';
        }
        if (customers.engagementTrend === 'up' &&
            orders.outcome === 'positive') {
            return 'aligned';
        }
        if (customers.engagementTrend === 'down' &&
            orders.outcome === 'negative') {
            return 'aligned';
        }
        return 'divergent';
    },
};
