// apps/frontend/src/pages/orders/useOrdersFt2Timeseries.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type OrdersFt2TimeseriesPoint = {
  date: string;
  ordersObserved: number;
  revenueTotal: number;
};

export type OrdersFt2TimeseriesSnapshot = {
  period: {
    from: string;
    to: string;
  };
  series: OrdersFt2TimeseriesPoint[];
};

/**
 * useOrdersFt2Timeseries
 * ---------------------
 * Fetches FT2 Orders timeseries facts.
 *
 * Rules:
 * - Read-only
 * - No params
 * - No transformation
 * - Fact-only (no intelligence)
 */
export function useOrdersFt2Timeseries(enabled: boolean) {
  return useQuery<OrdersFt2TimeseriesSnapshot>({
    queryKey: ['order-nexus', 'ft2', 'timeseries'],
    enabled,
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2/facts/timeseries'
      );
      return data;
    },
  });
}