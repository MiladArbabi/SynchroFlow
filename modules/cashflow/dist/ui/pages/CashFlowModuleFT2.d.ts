import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export type CashFlowComparison = {
    period: {
        from: string;
        to: string;
    };
    prior: {
        from: string;
        to: string;
    };
    prior_totals: {
        realized_revenue: number;
        pending_revenue: number;
        total_refunded: number;
    };
    delta: {
        realized_pct: number | null;
        pending_pct: number | null;
        refunds_pct: number | null;
    };
};
export type CashFlowSummary = {
    realized_revenue: number;
    pending_revenue: number;
    at_risk_revenue: number;
    total_refunded: number;
    inventory_value: number;
    net_cash_position: number;
    working_capital_locked: number;
    runway_days: number | null;
    comparison: CashFlowComparison | null;
};
export type CashFlowBucket = {
    label: string;
    orders: number;
    revenue: number;
    description: string;
};
export type CashFlowByConstraint = {
    constraint_type: string;
    orders: number;
    revenue_blocked: number;
};
export type PoOutflow = {
    supplier_name: string;
    po_id: string;
    expected_delivery_date: string | null;
    total_cost: number;
    status: string;
};
export type CashFlowSettings = {
    monthly_overhead_amount: number | null;
    starting_cash_balance: number | null;
    starting_cash_balance_set_at: string | null;
};
export type ProjectionPoint = {
    week: string;
    conservative: number;
    base: number;
    optimistic: number;
};
export type GrossProfit = {
    gross_revenue: number;
    total_cogs: number;
    gross_profit: number;
    gross_margin_pct: number | null;
};
export type CashFlowData = {
    summary: CashFlowSummary;
    gross_profit: GrossProfit;
    buckets: CashFlowBucket[];
    by_constraint: CashFlowByConstraint[];
    po_outflows: PoOutflow[];
    projection_60d: ProjectionPoint[];
    computed_at: string;
} | null;
export type CashFlowModuleFT2Props = {
    data: CashFlowData;
    isLoading: boolean;
    isError: boolean;
    currency?: CurrencyContext;
    settings?: CashFlowSettings | null;
    onSaveSettings?: (updates: {
        monthly_overhead_amount?: number;
        starting_cash_balance?: number;
    }) => Promise<void>;
};
export default function CashFlowModuleFT2(props: CashFlowModuleFT2Props): import("react").JSX.Element;
//# sourceMappingURL=CashFlowModuleFT2.d.ts.map