// apps/frontend/src/pages/wms/usePickAnalytics.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type PickAnalyticsSummary = {
  confirmed_scans: number;
  total_exceptions: number;
  total_units_picked: number;
  pick_accuracy_pct: number | null;
};

export type OperatorStat = {
  operator_id: number;
  scans: number;
  units_picked: number;
};

export type SkuException = {
  lasyncro_variant_id: string;
  title: string | null;
  sku: string | null;
  exception_count: number;
  error_rate_pct: number | null;
};

export type BatchTime = {
  pick_batch_id: string;
  total_units: number;
  units_picked: number;
  pick_claimed_at: string;
  pick_completed_at: string;
  picked_by: number;
  pick_duration_seconds: number;
};

export type PickAnalyticsResponse = {
  summary: PickAnalyticsSummary;
  operators: OperatorStat[];
  exceptions: SkuException[];
  batches: BatchTime[];
  days: number;
};

export function usePickAnalytics(days = 30) {
  return useQuery<PickAnalyticsResponse>({
    queryKey: ['wms', 'analytics', days],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/wms/analytics?days=${days}`
      );
      return data;
    },
    refetchInterval: 300_000, // 5 min — analytics are slow-changing
    placeholderData: (prev) => prev,
  });
}