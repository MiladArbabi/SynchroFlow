import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
// 2026-06-24: types moved to @lasyncro/shared (canonical cross-module
// contract, consumed by both this hook and the Margin module's
// ProfitTrustPanel). Re-exported here for back-compat with existing
// `from '../finances/useFinancesIntelligence'` import sites.
import type { FinancesComparison, FinancesIntelligenceData } from '@lasyncro/shared';
export type { FinancesComparison, FinancesIntelligenceData };

export function useFinancesIntelligence(range?: { from?: string | null; to?: string | null }) {
  const from = range?.from ?? null;
  const to   = range?.to ?? null;
  return useQuery<FinancesIntelligenceData>({
    queryKey: ['finances', 'intelligence', { from, to }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to',   to);
      const qs = params.toString();
      const { data } = await axiosInstance.get(
        `/api/v1/modules/finances/intelligence${qs ? `?${qs}` : ''}`
      );
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}