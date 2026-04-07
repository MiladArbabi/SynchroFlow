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
};

export type MarginOrder = {
  order_id: string;
  gross_revenue: string;
  estimated_cost: string;
  gross_margin: string;
  margin_pct: string;
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