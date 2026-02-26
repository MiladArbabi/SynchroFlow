// apps/frontend/src/pages/orders/useOrdersOperationalBrief.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * Decision Layer — Operational Brief Snapshot
 * -------------------------------------------
 * Contract:
 * - Direct passthrough of backend snapshot
 * - One row (latest brief_date)
 * - No transformation
 * - Backend is authoritative
 */

export type OrdersOperationalBrief = {
  shop_id: number;
  brief_date: string;
  critical_orders_count: number;
  negative_margin_orders_count: number;
  sla_breached_count: number;
  inventory_blocked_revenue: string;
  cash_realized_today: string;
  refund_exposure: string;
  top_10_priority_order_ids: string[];
  evaluated_at: string;
} | null;

export function useOrdersOperationalBrief() {
  return useQuery<OrdersOperationalBrief>({
    queryKey: ['orders', 'decision', 'operational-brief'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/orders/decision/operational-brief'
      );
      return data;
    },
  });
}