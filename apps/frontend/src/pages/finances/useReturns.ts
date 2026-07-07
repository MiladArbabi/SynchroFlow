// apps/frontend/src/pages/finances/useReturns.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type ReturnsSummary = {
  total_refunds: number;
  total_revenue_refunded: number;
  total_margin_leakage: number;
  avg_return_rate_pct: number;
  total_units_returned: number;
  total_units_restocked: number;
  restock_rate_pct: number;
  recovery_rate_pct: number;
  recovery_jobs_complete: number;
  recovery_jobs_total: number;
};

export type ReturnsByVariant = {
  lasyncro_variant_id: string;
  variant_title: string | null;
  sku: string | null;
  total_refunds: number;
  total_units_returned: number;
  total_units_restocked: number;
  revenue_leakage: number;
  margin_leakage: number | null;
  return_rate_pct: number;
  restock_rate_pct: number;
};
export type OrphanedReturnJob = {
  return_job_id: string;
  origin: 'customer_return' | 'undelivered_return';
  status: string;
  created_at: string;
  hours_since_event: number;
  refund_amount: number;
  severity: 'ok' | 'warning' | 'critical';
};
export type ReturnsResponse = {
  summary: ReturnsSummary;
  by_variant: ReturnsByVariant[];
  orphaned_jobs: OrphanedReturnJob[];
};

/**
 * useReturns
 * ----------
 * Fetches returns intelligence — summary and per-variant breakdown.
 * Refetches every 60s.
 */
export function useReturns() {
  return useQuery<ReturnsResponse>({
    queryKey: ['returns'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/returns');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}