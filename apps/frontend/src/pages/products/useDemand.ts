// apps/frontend/src/pages/products/useDemand.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type DemandVelocity = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
  available_quantity: number;
  units_sold_30d: number;
  units_sold_all_time: number;
  velocity_per_day: number;
  days_of_stock_remaining: number | null;
  reorder_signal: boolean;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  estimated_stockout_date: string | null;
};

export type DemandSummary = {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
};

export type DemandResponse = {
  summary: DemandSummary;
  variants: DemandVelocity[];
  computed_at: string;
};

export function useDemand() {
  return useQuery<DemandResponse>({
    queryKey: ['demand'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/demand');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}