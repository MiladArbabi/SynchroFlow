// apps/frontend/src/pages/finances/useMarginTrend.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type MarginTrendPoint = {
  date: string;
  avg_margin_pct: number;
  total_margin: number;
  total_revenue: number;
  order_count: number;
};

export type MarginTrendResponse = {
  data: MarginTrendPoint[];
  days: number;
};

export function useMarginTrend(days = 30) {
  return useQuery<MarginTrendResponse>({
    queryKey: ['finances', 'margin', 'trend', days],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/modules/finances/margin/trend?days=${days}`
      );
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}