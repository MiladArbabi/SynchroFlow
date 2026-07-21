import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
export type DemandVelocity = {
    lasyncro_variant_id: string;
    title: string | null;
    sku: string | null;
    product_title: string | null;
    unit_cost: number | null;
    available_quantity: number;
    units_sold_30d: number;
    units_sold_prev_30d: number;
    velocity_per_day: number;
    velocity_trend: 'up' | 'down' | 'stable';
    days_of_stock_remaining: number | null;
    reorder_signal: boolean;
    reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
    estimated_stockout_date: string | null;
    suggested_reorder_qty: number | null;
    supplier_lead_time_days: number | null;
};
export type DemandSummary = {
    total_variants_tracked: number;
    critical_reorder_count: number;
    warning_reorder_count: number;
    stockout_count: number;
    avg_days_of_stock: number | null;
    total_inventory_value: number;
};
export type DemandData = {
    summary: DemandSummary;
    variants: DemandVelocity[];
    computed_at: string;
} | null;
export type DemandModuleFT2Props = {
    data: DemandData;
    isLoading: boolean;
    isError: boolean;
    currency?: CurrencyContext;
};
export default function DemandModuleFT2(props: DemandModuleFT2Props): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=DemandModuleFT2.d.ts.map