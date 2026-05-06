// apps/frontend/src/pages/returns/useReturnsCorrelation.ts
import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type CorrelationRow = {
  lasyncro_variant_id: string;
  variant_title: string | null;
  sku: string | null;
  receive_job_id: string | null;
  batch_received_at: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  units_returned: number;
  units_sold: number;
  return_rate_pct: number | null;
  revenue_lost: number;
};

export type ReturnsCorrelationResponse = {
  data: CorrelationRow[];
};

export function useReturnsCorrelation() {
  return useQuery<ReturnsCorrelationResponse>({
    queryKey: ['returns', 'correlation'],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/modules/returns/correlation'
      );
      return data;
    },
    refetchInterval: 300_000,
    placeholderData: (prev) => prev,
  });
}