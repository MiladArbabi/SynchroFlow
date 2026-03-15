// apps/frontend/src/pages/orders/useOrdersFt2Timeseries.ts

import { FT2DateRange } from '@lasyncro/ui-ft2';
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * OrdersFt2TimeseriesPoint
 * ------------------------
 * Direct representation of backend projection row.
 *
 * Source:
 * orders_operational_control_snapshot
 *
 * Rules:
 * - exact schema match with backend
 * - no frontend renaming
 * - deterministic passthrough
 */
export type OrdersFt2TimeseriesPoint = {
  snapshot_date: string;
  constrained_orders: number;
  queue_awaiting_inventory: number;
  queue_manual_review: number;
  orders_at_sla_risk: number;
  revenue_blocked_inventory: number;
};

export type OrdersFt2TimeseriesSnapshot = {
  period: {
    from: string;
    to: string;
  };
  
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
      const { data } = await axiosInstance.get(
        '/api/v1/modules/order-nexus/ft2/facts/timeseries',{
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