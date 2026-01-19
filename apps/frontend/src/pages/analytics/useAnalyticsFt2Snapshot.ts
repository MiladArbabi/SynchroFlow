// NOTE:
// This type mirrors Analytics FT2 public contract.
// It MUST stay structurally identical to the module contract.
// Drift is prevented by integration tests, not imports.

// apps/frontend/src/pages/analytics/useAnalyticsFt2Snapshot.ts
import { FT2DateRange } from '@lasyncro/ui-ft2';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

type AnalyticsFt2Domain = {
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type AnalyticsFt2Snapshot = {
  snapshot: {
    id: string;
    extractedAt: string;
  };
  domains: {
    orders: AnalyticsFt2Domain | null;
    products: AnalyticsFt2Domain | null;
    customers: AnalyticsFt2Domain | null;
    finances: AnalyticsFt2Domain | null;
  };
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
    queryKey: [
      'analytics', 'ft2',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/analytics/ft2', {
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