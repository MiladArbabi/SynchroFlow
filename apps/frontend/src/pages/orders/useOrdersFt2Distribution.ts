// apps/frontend/src/pages/orders/useOrdersFt2Distribution.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type OrdersFt2DistributionSnapshot = {
  totalOrders: number;
  minOrderValue: number | null;
  medianOrderValue: number | null;
  maxOrderValue: number | null;
  histogram: {
    bucketStart: number;
    bucketEnd: number;
    count: number;
  }[];
};

/**
 * useOrdersFt2Distribution
 * -----------------------
 * Fetches FT2 Orders distribution facts.
 *
 * Rules:
 * - Read-only
 * - No params
 * - No transformation
 * - Fact-only (no intelligence)
 */
export function useOrdersFt2Distribution(enabled: boolean) {
  return useQuery<OrdersFt2DistributionSnapshot>({
    queryKey: ['order-nexus', 'ft2', 'distribution'],
    enabled,
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2/facts/distribution'
      );
      return data;
    },
  });
}