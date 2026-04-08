// apps/frontend/src/pages/customers/useCustomerLtv.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type CustomerLtvRecord = {
  customer_hashed_id: string;
  total_orders: number;
  total_revenue: number;
  avg_order_value: number;
  first_order_at: string | null;
  last_order_at: string | null;
  days_since_last_order: number | null;
  total_refunds: number;
  net_revenue: number;
  churn_risk: 'low' | 'medium' | 'high';
  customer_tier: 'VIP' | 'CORE' | 'AT_RISK' | 'LOST' | 'NEW';
};

export type CustomerLtvSummary = {
  total_customers: number;
  avg_ltv: number;
  avg_order_frequency: number;
  avg_days_between_orders: number | null;
  vip_count: number;
  at_risk_count: number;
  lost_count: number;
};

export type CustomerLtvResponse = {
  summary: CustomerLtvSummary;
  customers: CustomerLtvRecord[];
  computed_at: string;
};

export function useCustomerLtv() {
  return useQuery<CustomerLtvResponse>({
    queryKey: ['customers', 'ltv'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/modules/customers/ltv');
      return data;
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}