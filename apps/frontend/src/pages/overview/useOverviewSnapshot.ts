// apps/frontend/src/pages/overview/useOverviewSnapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
/**
 * OverviewFt2Snapshot
 * --------------------
 * Backend FT2 snapshot.
 *
 * This type is:
 * - transport-level
 * - NOT a UI contract
 * - NOT adapted
 *
 * It must mirror the backend response exactly.
 */
// apps/frontend/src/pages/overview/useOverviewSnapshot.ts

export interface OverviewFt2Snapshot {
  trust: {
    dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
    syncCoverage: 'complete' | 'partial' | 'missing' | 'unknown' | null;
    crossSourceConsistency: 'consistent' | 'inconsistent' | 'unknown' | null;
    trustEligible: boolean | null;
  } | null;

  context: {
    ordersObserved: number | null;
    productsObserved: number | null;
    customersObserved: number | null;
  };

  snapshot: {
    orders: {
      revenueTotal: number | null;
      currency: string | null;
    } | null;

    products: null;
    customers: null;
  };

  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
  } | null;
};

/**
 * useROOverviewSnapshot
 * --------------------
 * Fetches RO Overview FT2 snapshot.
 *
 * Rules:
 * - No transformation
 * - No defaults
 * - No lifecycle logic
 * - Query success ≠ render permission
 */
export function useOverviewSnapshot() {
  return useQuery<OverviewFt2Snapshot>({
    queryKey: ['ft2', 'overview'],
    queryFn: async () => {
      const res = await axiosInstance.get('/api/v1/modules/overview/ft2');
      return res.data;
    },
    staleTime: 30_000,
  });
}