import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import type { FT2DateRange } from '@lasyncro/ui-ft2';

/**
 * Execution-Aware Revenue Snapshot
 * --------------------------------
 * Mirrors backend response exactly.
 * No transformation. No defaults.
 */
export type ExecutionAwareRevenueSnapshot = {
  mode: 'EXECUTION_AWARE';
  revenue: {
    fulfilled: number;
    unfulfilled: number;
    unknown: number;
  };
  visibility: {
    status: 'sufficient' | 'insufficient';
    reason?: 'PARTIAL_LINKAGE' | 'NO_FULFILLMENT_DATA';
  };
};

/**
 * useOrderNexusExecutionRevenue
 * -----------------------------
 * Explicit Phase 6 revenue surface.
 *
 * Rules:
 * - Opt-in usage only
 * - No fallback to FT2
 * - No inference
 */
export function useOrderNexusExecutionRevenue(
  range: FT2DateRange
) {
  return useQuery<ExecutionAwareRevenueSnapshot>({
    queryKey: [
      'order-nexus',
      'revenue',
      'execution-aware',
      range.preset,
      range.from,
      range.to,
    ],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/revenue',
        {
          params:
            range.preset === 'custom'
              ? {
                  mode: 'execution_aware',
                  preset: 'custom',
                  from: range.from,
                  to: range.to,
                }
              : {
                  mode: 'execution_aware',
                  preset: range.preset,
                },
        }
      );

      return data;
    },
  });
}