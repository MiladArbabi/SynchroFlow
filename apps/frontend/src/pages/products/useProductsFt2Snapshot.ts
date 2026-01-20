// apps/frontend/src/pages/products/useProductsFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';
import type { ProductsFt2Snapshot } from './useProductsFt2Adapter';

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
    queryKey: [
      'products', 'ft2',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/products/ft2',
        {
          params:
          range.preset === 'custom'
            ? {
                preset: 'custom',
                from: range.from,
                to: range.to,
              }
            : {
                preset: range.preset,
              },
            }
          );
      return data;
    },
  });
}