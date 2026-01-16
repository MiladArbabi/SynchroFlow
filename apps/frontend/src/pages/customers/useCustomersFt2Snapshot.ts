import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

export type CustomersFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  sessionsObserved?: number | null;

  systemState?: {
    status: 'healthy' | 'degraded' | 'partial' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    reason?: string;
  } | null;

  timeSignal?: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
};

/**
 * useCustomersFt2Snapshot
 * ----------------------
 * Fetches authoritative FT2 Customers snapshot.
 *
 * Rules:
 * - Backend-owned facts
 * - Explicit time range
 * - Read-only
 * - No inference
 * - No transformation
 */
export function useCustomersFt2Snapshot(range: FT2DateRange) {
  return useQuery<CustomersFt2Snapshot>({
    queryKey: ['customers', 'ft2', range.preset],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/customers/ft2',
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