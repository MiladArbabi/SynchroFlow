export type FinancesComparison = {
    period: {
        from: string;
        to: string;
    };
    prior: {
        from: string;
        to: string;
    };
    delta: {
        revenuePct: number | null;
        marginPct: number | null;
        netMarginPct: number | null;
        refundsPct: number | null;
        avgMarginPtDelta: number;
    };
    priorTotals: {
        totalRevenue: number;
        totalMargin: number;
        totalRefunds: number;
        netMargin: number;
        avgMarginPct: number;
    };
};
export type FinancesIntelligenceData = {
    totalRevenue: number;
    totalCost: number;
    totalMargin: number;
    avgMarginPct: number;
    totalRefunds: number;
    netMargin: number;
    netMarginPct: number | null;
    negativemarginOrders: number;
    costCoverage: {
        totalVariants: number;
        zeroCostCount: number;
        coveragePct: number | null;
    };
    blockedRevenue: number | null;
    blockedMarginValue: number | null;
    constrainedOrders: number | null;
    totalShippingCost: number | null;
    trueMargin: number | null;
    trueMarginPct: number | null;
    hasCarrierData: boolean;
    comparison: FinancesComparison | null;
};
//# sourceMappingURL=finances-intelligence.d.ts.map