/**
 * RevenueOverviewInfoBlockProps
 * -----------------------------
 * Phase B2:
 * - executionCoverage REMOVED
 * - Epistemic state is the single authority
 * - Component performs NO conditional logic
 */
type RevenueOverviewInfoBlockProps = {
    span?: number;
    revenue: {
        totalSales: number | null;
        earned: number | null;
        pending: number | null;
    };
};
export declare function RevenueOverviewInfoBlock({ span, revenue, }: RevenueOverviewInfoBlockProps): import("react/jsx-runtime").JSX.Element;
export {};
