import { FT2DateRange } from '@lasyncro/ui-ft2';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type FinancesFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    revenueObserved?: number | null;
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

  timeAwareness?: {
    history: 'sufficient' | 'insufficient';
    confidence: 'high' | 'medium' | 'low' | 'unknown';
  } | null;

  timeline?: {
    bucket: 'day';
    points: Array<{
      from: string;
      to: string;
      revenueObserved: number | null;
    }>;
  } | null;

  coverageTimeline?: {
    bucket: 'day';
    points: Array<{
      from: string;
      to: string;
      coveragePct: number | null;
    }>;
  } | null;

  blindSpots?: {
    costs: 'unknown' | 'known';
    refunds: 'unknown' | 'known';
    history: 'insufficient' | 'sufficient';
  } | null;

  decisionSafety?: {
    status: 'safe' | 'unsafe' | 'unknown';
  } | null;

  profitPreconditions?: {
    status: 'ready' | 'not_ready';
  } | null;
};

/**
 * useFinancesFt2Snapshot
 * ---------------------
 * Fetches authoritative Finances FT2 snapshot.
 *
 * Rules:
 * - Backend-owned period
 * - Date-range scoped
 * - Read-only
 * - No transformation
 */
export function useFinancesFt2Snapshot(range: FT2DateRange) {
  return useQuery<FinancesFt2Snapshot>({
    queryKey: [
      'finances', 'ft2',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/finances/ft2', {
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
