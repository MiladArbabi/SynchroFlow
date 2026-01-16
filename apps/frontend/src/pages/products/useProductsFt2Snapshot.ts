// apps/frontend/src/pages/products/useProductsFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

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

  signals?: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
  } | null;
};

/**
 * useProductsFt2Snapshot
 * ---------------------
 * Fetches authoritative FT2 Products snapshot.
 *
 * Rules:
 * - Page-owned period
 * - Read-only
 * - No inference
 * - Deterministic refetch
 */
export function useProductsFt2Snapshot(range: FT2DateRange) {
  return useQuery<ProductsFt2Snapshot>({
    queryKey: ['products', 'ft2', range.preset],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/products/ft2',
        {
          params: {
            preset: range.preset
          },
        }
      );
      return data;
    },
  });
}