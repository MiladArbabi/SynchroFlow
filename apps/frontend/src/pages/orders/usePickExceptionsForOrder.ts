// apps/frontend/src/pages/orders/usePickExceptionsForOrder.ts
//
// Fetches pick exceptions scoped to a single order.
// Endpoint: GET /api/v1/wms/problem-center/pick-exceptions?order_id=:id
// Backend: httpGetProblemCenterExceptions
//
// See entity-detail-modal-playbook.md §2.3 — resolving ONE exception here
// (httpResolveException) does NOT unblock the order. An order can have
// multiple open exceptions; resolving one doesn't mean the order ships.
// Unblocking is a SEPARATE action: resolve_operational_block, via the
// existing useExecuteOrderDecision in useOrderDecision.ts. Do not conflate
// the two invalidation scopes.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface PickException {
  pick_exception_id: string;
  pick_batch_id: string;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  exception_type: string;
  stage: string;
  quantity_required: number;
  quantity_found: number;
  raised_by: number;
  raised_at: string;
  resolved: boolean;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  variant_title: string | null;
  sku: string | null;
  lasyncro_order_id: string | null;
  batch_short_id: string;
}

export interface PickExceptionsResponse {
  exceptions: PickException[];
  total_unresolved: number;
}

export function usePickExceptionsForOrder(orderId: string | null) {
  return useQuery<PickExceptionsResponse>({
    queryKey: ['pick-exceptions', 'by-order', orderId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        '/api/v1/wms/problem-center/pick-exceptions',
        { params: { order_id: orderId } }
      );
      return data;
    },
    enabled: !!orderId,
  });
}

export interface ResolveExceptionPayload {
  exceptionId: string;
  resolutionNote: string;
}

/**
 * useResolvePickException
 * ------------------------
 * Only invalidates this order's exception list — does NOT touch
 * order-detail/order-decision queries. See file header.
 */
export function useResolvePickException(orderId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<{ pick_exception_id: string; resolved: boolean }, Error, ResolveExceptionPayload>({
    mutationFn: async ({ exceptionId, resolutionNote }) => {
      const { data } = await axiosInstance.post(
        `/api/v1/wms/problem-center/pick-exceptions/${exceptionId}/resolve`,
        { resolution_note: resolutionNote }
      );
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pick-exceptions', 'by-order', orderId] });
    },
  });
}
