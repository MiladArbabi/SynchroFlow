import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type BillingUsageData = {
  tier: string;
  ingested_orders: number;
  shipped_orders: number;
  processed_orders: number;
  included_allowance: number;
  remaining_included: number;
  usage_percent: number;
  overage_units: number;
  overage_rate_cents: number | null;
  estimated_overage_cents: number;
  period_starts_at: string | null;
  period_ends_at: string | null;
};

export function useBillingUsage(options: {
  enabled?: boolean;
  poll?: boolean;
} = {}) {
  const enabled = options.enabled ?? true;
  const poll = options.poll ?? false;

  return useQuery<BillingUsageData>({
    queryKey: ['billing-usage'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/billing/usage');
      return data;
    },
    enabled,
    refetchInterval: enabled && poll ? 60_000 : false,
    placeholderData: (prev) => prev,
  });
}
