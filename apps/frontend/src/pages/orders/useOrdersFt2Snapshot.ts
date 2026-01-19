// apps/frontend/src/pages/orders/useOrdersFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

export type OrdersFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  ordersObserved?: number | null;

  totals?: {
    revenueTotal?: number | null;
    costTotal?: number | null;
    currency?: string | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage?: {
    completenessPct?: number | null;
  };

  visibility?: {
    status: 'sufficient' | 'insufficient';
  } | null;
};

/**
 * useOrdersFt2Snapshot
 * -------------------
 * Fetches authoritative FT2 Order-Nexus snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - No params
 * - Read-only
 * - No transformation
 */
export function useOrdersFt2Snapshot(range: FT2DateRange) {
  return useQuery<OrdersFt2Snapshot>({
    queryKey: [
      'order-nexus',
      'ft2',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2',
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
        });
      return data;
    },
  });
}
