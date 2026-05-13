// apps/frontend/src/pages/finances/useFinancesIntelligence.ts
//
// Fetches aggregated intelligence signals for the Finances Intelligence tab.
// State-based (not period-scoped) — reflects current shop financial reality.

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type FinancesIntelligenceData = {
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  avgMarginPct: number;
  totalRefunds: number;
  netMargin: number;
  netMarginPct: number | null;
  negativemarginOrders: number;
  costCoverage: {
    totalVariants: number;
    zeroCostCount: number;
    coveragePct: number | null;
  };
  blockedRevenue: number | null;
  blockedMarginValue: number | null;
  constrainedOrders: number | null;
};

export function useFinancesIntelligence() {
  return useQuery<FinancesIntelligenceData>({
    queryKey: ['finances', 'intelligence'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/finances/intelligence');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}