// apps/mobile/src/intelligence/types.ts
// Shared types for all Intelligence segment views.

export interface CashSummary {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  net_cash_position: number;
  working_capital_locked: number;
}

export interface GrossProfit {
  gross_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
}

export interface PoOutflow {
  po_id: string;
  supplier_name: string;
  expected_delivery_date: string;
  total_cost: number;
}

export interface ProjectionWeek {
  week: string;
  conservative: number;
  base: number;
  optimistic: number;
}

export interface CashFlowData {
  summary: CashSummary;
  gross_profit: GrossProfit;
  po_outflows: PoOutflow[];
  projection_60d: ProjectionWeek[];
  computed_at: string;
}

export interface DemandSummary {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
}

export interface DemandVariant {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  days_of_stock_remaining: number | null;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  available_quantity: number;
  velocity_per_day: number | null;
}

export interface DemandData {
  summary: DemandSummary;
  variants: DemandVariant[];
  computed_at: string;
}

export interface SkuMargin {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  total_units_sold: number;
  gross_revenue: number;
  estimated_cost: number;
  gross_margin: number;
  margin_pct: number;
}

export interface ReturnCorrelation {
  lasyncro_variant_id: string;
  sku: string | null;
  variant_title: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  receive_job_id: string | null;
  batch_received_at: string | null;
  units_sold: number;
  units_returned: number;
  return_rate_pct: number | null;
}

export type Segment = 'cashflow' | 'demand' | 'finances' | 'returns';

export const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'cashflow',  label: 'Cash Flow' },
  { key: 'demand',    label: 'Demand' },
  { key: 'finances',  label: 'Finances' },
  { key: 'returns',   label: 'Returns' },
];

export const MARGIN_TARGET = 40;