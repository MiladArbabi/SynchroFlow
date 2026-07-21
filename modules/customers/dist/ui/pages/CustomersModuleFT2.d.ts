import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';
/**
 * LOCAL TYPES
 * -----------
 * Mirror CustomerLtvResponse from frontend hook.
 * Defined locally to avoid cross-rootDir import.
 */
export type CustomerLtvRecord = {
    customer_hashed_id: string;
    total_orders: number;
    total_revenue: number;
    avg_order_value: number;
    first_order_at: string | null;
    last_order_at: string | null;
    days_since_last_order: number | null;
    total_refunds: number;
    net_revenue: number;
    churn_risk: 'low' | 'medium' | 'high';
    customer_tier: 'VIP' | 'CORE' | 'AT_RISK' | 'LOST' | 'NEW';
};
export type CustomerLtvSummary = {
    total_customers: number;
    avg_ltv: number;
    avg_order_frequency: number;
    avg_days_between_orders: number | null;
    vip_count: number;
    at_risk_count: number;
    lost_count: number;
};
export type CustomerLtvData = {
    summary: CustomerLtvSummary;
    customers: CustomerLtvRecord[];
    computed_at: string;
} | null;
/**
 * CUSTOMERS MODULE FT2 PROPS
 * --------------------------
 * Rebuilt from scratch — LTV-first design.
 * Previous snapshot-based props discarded.
 */
export interface CustomersModuleFT2Props {
    ltv: CustomerLtvData;
    /** CURRENCY LAYER 3 — pass from EntitlementsContext, never hardcode */
    currency?: CurrencyContext;
}
export default function CustomersModuleFT2(props: CustomersModuleFT2Props): import("react/jsx-runtime").JSX.Element;
