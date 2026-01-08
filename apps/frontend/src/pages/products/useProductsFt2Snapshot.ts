// apps/frontend/src/pages/products/useProductsFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type ProductsFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    productsObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
};

/**
 * useProductsFt2Snapshot
 * ---------------------
 * Fetches authoritative FT2 Products snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - No params
 * - Read-only
 * - No transformation
 */
export function useProductsFt2Snapshot(enabled: boolean) {
  return useQuery<ProductsFt2Snapshot>({
    queryKey: ['products', 'ft2'],
    enabled,
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/products/ft2');
      return data;
    },
  });
}