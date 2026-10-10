// apps/frontend/src/pages/orders/usePickExceptionsForOrder.ts
//
// Fetches pick exceptions scoped to a single order.
// Endpoint: GET /api/v1/wms/problem-center/pick-exceptions?order_id=:id
// Backend: httpGetProblemCenterExceptions
//
// GH-1238 / PC-SAFE-01 W4: read-only. The legacy direct resolve
// (POST /problem-center/pick-exceptions/:id/resolve) is retired — closing a
// Pick exception requires canonical recovery evidence in Problem Center.
// Unblocking the order stays a SEPARATE action (resolve_operational_block via
// useExecuteOrderDecision in useOrderDecision.ts).

import { useQuery } from '@tanstack/react-query';
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
    // FIX (2026-07-04): same staleTime=0 + refetchOnWindowFocus flicker
    // as useOrderDecision.ts / useOrderDetail.ts.
    staleTime: 30_000,
  });
}
