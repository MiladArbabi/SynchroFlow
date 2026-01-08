// apps/frontend/src/pages/finances/useFinancesFt2Snapshot.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type FinancesFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    netObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage?: {
    completenessPct: number | null;
  };
};

/**
 * useFinancesFt2Snapshot
 * ---------------------
 * Fetches authoritative Finances FT2 snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - No params
 * - Read-only
 * - No transformation
 */
export function useFinancesFt2Snapshot(enabled: boolean) {
  return useQuery<FinancesFt2Snapshot>({
    queryKey: ['finances', 'ft2'],
    enabled,
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/finances/ft2'
      );
      return data;
    },
  });
}