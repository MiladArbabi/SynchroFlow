// apps/frontend/src/pages/finances/useSkuMargin.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type SkuMarginRow = {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string | null;
  total_units_sold: number;
  gross_revenue: number;
  estimated_cost: number;
  gross_margin: number;
  margin_pct: number;
};

export type SkuMarginResponse = {
  data: SkuMarginRow[];
};

export function useSkuMargin(options?: {
  order?: 'asc' | 'desc';
  limit?: number;
}) {
  const { order = 'asc', limit = 50 } = options ?? {};

  return useQuery<SkuMarginResponse>({
    queryKey: ['finances', 'margin', 'sku', { order, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({
        order,
        limit: String(limit),
      });
      const { data } = await axiosInstance.get(
        `/api/v1/modules/finances/margin/sku?${params}`
      );
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}