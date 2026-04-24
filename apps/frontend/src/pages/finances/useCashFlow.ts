// apps/frontend/src/pages/finances/useCashFlow.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type CashFlowSummary = {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
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

export type CashFlowResponse = {
  summary: CashFlowSummary;
  gross_profit: GrossProfit;
  buckets: CashFlowBucket[];
  by_constraint: CashFlowByConstraint[];
  po_outflows: PoOutflow[];
  projection_60d: ProjectionPoint[];
  computed_at: string;
};

/**
 * useCashFlow
 * -----------
 * Fetches cash flow projection — summary, buckets, constraint breakdown.
 * Refetches every 60s.
 */
export function useCashFlow() {
  return useQuery<CashFlowResponse>({
    queryKey: ['cashflow'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/cashflow');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}