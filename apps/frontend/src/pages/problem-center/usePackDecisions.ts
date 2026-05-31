// apps/frontend/src/pages/problem-center/usePackDecisions.ts
//
// Fetches pending pack decision requests for the Problem Center strip.
// Polls every 10s — decisions are time-sensitive (packer is waiting).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export type PackDecisionRequest = {
  id: string;
  pick_batch_id: string;
  lasyncro_order_id: string;
  lasyncro_line_item_id: string;
  exception_type: string;
  question: string;
  status: 'pending' | 'approved' | 'rejected';
  partial_shipment: boolean | null;
  raised_by: number;
  raised_at: string;
  resolved_by: number | null;
  resolved_at: string | null;
  note: string | null;
  // joined fields
  external_order_id: string | null;
  variant_title: string | null;
  sku: string | null;
};

export function usePackDecisions(status = 'pending') {
  return useQuery<{ requests: PackDecisionRequest[]; total: number }>({
    queryKey: ['pack-decisions', status],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/wms/pack/decision-requests?status=${status}`
      );
      return data;
    },
    refetchInterval: status === 'pending' ? 10_000 : false,
  });
}

/**
 * useResolvePackDecision
 * ----------------------
 * Owner approves or rejects a pending pack decision.
 * Optimistically removes from pending list on mutate.
 */
export function useResolvePackDecision() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    { requestId: string; status: 'approved' | 'rejected'; partialShipment?: boolean; note?: string }
  >({
    mutationFn: async ({ requestId, status, partialShipment, note }) => {
      await axiosInstance.post(
        `/api/v1/wms/pack/decision-request/${requestId}/resolve`,
        { status, partial_shipment: partialShipment, note }
      );
    },
    onMutate: async ({ requestId }) => {
      await queryClient.cancelQueries({ queryKey: ['pack-decisions', 'pending'] });
      const previous = queryClient.getQueryData<{ requests: PackDecisionRequest[]; total: number }>(
        ['pack-decisions', 'pending']
      );
      queryClient.setQueryData<{ requests: PackDecisionRequest[]; total: number }>(
        ['pack-decisions', 'pending'],
        (old) => old ? {
          requests: old.requests.filter(r => r.id !== requestId),
          total: Math.max(0, old.total - 1),
        } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context: { previous?: { requests: PackDecisionRequest[]; total: number } } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(['pack-decisions', 'pending'], context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pack-decisions'] }),
  });
}

/**
 * useOrderPackDecisions
 * ---------------------
 * Fetches all pack decision requests for a specific order — all statuses.
 * Used in Order Detail page to show decision history.
 */
export function useOrderPackDecisions(lasyncroOrderId: string | null) {
  return useQuery<{ requests: PackDecisionRequest[]; total: number }>({
    queryKey: ['pack-decisions', 'order', lasyncroOrderId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/wms/pack/decision-requests?status=all&order_id=${lasyncroOrderId}`
      );
      return data;
    },
    enabled: !!lasyncroOrderId,
    staleTime: 30_000,
  });
}