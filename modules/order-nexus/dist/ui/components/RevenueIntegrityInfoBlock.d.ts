export interface RevenueIntegrityInfoBlockProps {
    /**
     * FT2Row layout participation.
     * Allows this panel to participate in
     * the Control Tower span layout engine.
     */
    span?: number;
    at_risk_revenue: number;
    revenue_leakage: number;
    avg_contribution_margin_pct: number;
}
export declare function RevenueIntegrityInfoBlock({ span, at_risk_revenue, revenue_leakage, avg_contribution_margin_pct, }: RevenueIntegrityInfoBlockProps): import("react/jsx-runtime").JSX.Element;
