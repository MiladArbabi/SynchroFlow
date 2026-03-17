// apps/frontend/src/pages/orders/useOrdersFt2Timeseries.ts

import { FT2DateRange } from '@lasyncro/ui-ft2';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * Contract aligned with backend /orders/operational-pressure
 * Only fields guaranteed by API are included.
 */
export type OrdersFt2TimeseriesPoint = {
  snapshot_date: string;
  queue_awaiting_inventory: number;
  orders_at_sla_risk: number;
  revenue_blocked_inventory: number;
};

export type OrdersFt2TimeseriesSnapshot = {
  period: {
    from: string;
    to: string;
  };
  /**
   * Freshness signals from backend
   */
  lastSnapshotDate: string | null;
  isStale: boolean;
  
  /**
   * Raw projection rows.
   * Do NOT reshape in this layer.
   * Adapters handle UI mapping.
   */
  series: OrdersFt2TimeseriesPoint[];
};

/**
 * useOrdersFt2Timeseries
 * ---------------------
 * Fetches FT2 Orders timeseries facts.
 *
 * Rules:
 * - Read-only
 * - No params
 * - No transformation
 * - Fact-only (no intelligence)
 */
export function useOrdersFt2Timeseries(range: FT2DateRange) {
  return useQuery<OrdersFt2TimeseriesSnapshot>({
    queryKey: ['order-nexus', 'ft2', 'timeseries', range.preset],
      queryFn: async () => {
        /**
         * ⚠️ Switched to authoritative Operational Pressure contract
         * Removes dependency on generic FT2 timeseries
         */
        const { data } = await axiosInstance.get(
          '/api/v1/orders/operational-pressure'
        );

      /**
      * Normalize to expected structure
      */
      return {
        period: {
          from: '',
          to: '',
        },
        series: data.series ?? [],
        lastSnapshotDate: data.lastSnapshotDate ?? null,
        isStale: data.isStale ?? true,
      };
    },
  });
}