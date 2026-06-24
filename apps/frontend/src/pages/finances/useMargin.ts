// apps/frontend/src/pages/finances/useMargin.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type MarginSummary = {
  order_count: number;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  avg_margin_pct: number;
  min_margin_pct: number;
  max_margin_pct: number;
  // FIN-01 (2026-06-23): backend surfaces shipping + true-margin fields on
  // every margin response. Nullable until a carrier label exists.
  total_shipping_cost: number | null;
  avg_true_margin_pct: number | null;
};

export type MarginOrder = {
  order_id: string;
  // FIN-12 (2026-06-23): backend now coerces to numbers (Number(...) per
  // controller). Types previously lied as strings — bringing types in
  // line with runtime so frontend can drop silent parseFloat() calls.
  gross_revenue: number;
  estimated_cost: number;
  gross_margin: number;
  margin_pct: number;
  // FIN-01 (2026-06-23): true-margin surface — null until carrier data exists.
  carrier_shipping_cost: number | null;
  true_margin: number | null;
  true_margin_pct: number | null;
  aggregate_version: number;
  fulfillment_status: string | null;
  evaluated_at: string;
};

export type MarginResponse = {
  summary: MarginSummary;
  orders: MarginOrder[];
  pagination: {
    page: number;
    limit: number;
  };
};

/**
 * useMargin
 * ---------
 * Fetches shop margin summary and per-order breakdown.
 * Refetches every 60s — margin data changes slowly.
 */
export function useMargin(options?: {
  status?: 'all' | 'pending' | 'fulfilled';
  page?: number;
  limit?: number;
}) {
  const { status = 'all', page = 1, limit = 50 } = options ?? {};

  return useQuery<MarginResponse>({
    queryKey: ['finances', 'margin', { status, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({
        status,
        page: String(page),
        limit: String(limit),
      });
      const { data } = await axiosInstance.get(
        `/api/v1/modules/finances/margin?${params}`
      );
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}