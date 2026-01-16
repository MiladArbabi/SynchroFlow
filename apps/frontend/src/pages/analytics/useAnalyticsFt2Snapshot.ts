// apps/frontend/src/pages/analytics/useAnalyticsFt2Snapshot.ts
import { FT2DateRange } from '@lasyncro/ui-ft2';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type AnalyticsFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    revenueObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative';
  } | null;

  trend?: {
    direction: 'unknown';
  } | null;
};

/**
 * useAnalyticsFt2Snapshot
 * ----------------------
 * Fetches authoritative Analytics FT2 snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - No params
 * - Read-only
 * - No transformation
 */
export function useAnalyticsFt2Snapshot(range: FT2DateRange) {
  return useQuery<AnalyticsFt2Snapshot>({
    queryKey: ['analytics', 'ft2', range.preset],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/analytics/ft2', {
        params: {
          preset: range.preset
        },
      });
      return data;
    },
  });
}