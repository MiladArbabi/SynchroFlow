// apps/frontend/src/pages/returns/useReturnJob.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type ReturnJobLine = {
  lasyncro_refund_line_item_id: string;
  refunded_quantity: number;
  item_condition: 'resellable' | 'repackable' | 'damaged' | 'unsellable' | null;
  quantity_received: number | null;
  processed_at: string | null;
  variant_title: string | null;
  sku: string | null;
};

export type ReturnJobDetail = {
  return_job_id: string;
  origin: 'customer_return' | 'undelivered_return';
  status: string;
  undelivered_reason: string | null;
  owner_decision: string | null;
  notes: string | null;
  claimed_by: number | null;
  claimed_at: string | null;
  created_at: string;
  external_order_id: string | null;
  total_refund_amount: string;
  refund_executed_at: string | null;
  lines: ReturnJobLine[];
};

export function useReturnJob(returnJobId: string) {
  return useQuery<{ data: ReturnJobDetail }>({
    queryKey: ['return-job', returnJobId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(`/api/v1/modules/returns/jobs/${returnJobId}`);
      return data;
    },
    enabled: !!returnJobId,
  });
}

export function useClaimReturnJob(returnJobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error>({
    mutationFn: async () => {
      await axiosInstance.post(`/api/v1/modules/returns/jobs/${returnJobId}/claim`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['return-job', returnJobId] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
    },
  });
}