// apps/frontend/src/pages/wms/useOrderPool.ts
//
// WMS ORDER POOL HOOKS
// --------------------
// Shared data/actions for the release-pool surface.
//
// Used by:
// - ReleaseQueuePage
// - OrdersFT2Page priority actions
// - OrderFlowPage
//
// Backend ownership:
// - GET  /api/v1/wms/order-pool
// - POST /api/v1/wms/orders/:orderId/priority
// - POST /api/v1/wms/batch/release
//
// Query keys:
// - ['wms', 'order-pool']
// - ['wms', 'batches']

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

export interface PoolOrder {
  lasyncro_order_id: string;
  external_order_id: string | null;
  total_price: string;
  currency: string;
  order_created_at: string;
  promised_ship_by: string | null;
  is_priority_flagged: boolean;
  is_shipping_sla_breached: boolean | null;
  customer_name: string | null;
  line_item_count: number;
  unit_count: number;
  zone_distribution: string[] | string;
}

export type OrderPoolEmptyReason =
  | 'ALL_ELIGIBLE_ORDERS_ALREADY_BATCHED'
  | 'ORDERS_BLOCKED'
  | 'ORDERS_NOT_READY'
  | 'NO_UNFULFILLED_ORDERS'
  | 'NO_ORDERS'
  | null;

export interface OrderPoolSummary {
  ready_for_release_count: number;
  in_batch_order_count: number;
  active_batch_count: number;
  blocked_count: number;
  fulfilled_count: number;
  not_ready_count: number;
}

export interface OrderPool {
  eligible_order_count: number;
  max_batch_line_items: number;
  orders: PoolOrder[];
  summary?: OrderPoolSummary;
  empty_reason?: OrderPoolEmptyReason;
}

export interface ReleaseBatchPayload {
  priority_order_ids?: string[];
  assigned_operator_id?: number;
  assigned_packer_id?: number;
  exclusive?: boolean;
}

export type SkippedReleaseOrderReason =
  | 'blocked'
  | 'already_batched'
  | 'status_changed'
  | 'not_in_pool';

export interface SkippedReleaseOrder {
  order_id: string;
  external_order_id: string | null;
  reason: SkippedReleaseOrderReason;
  label: string;
}

export interface ReleaseBatchResult {
  pick_batch_id: string | null;
  order_count: number;
  total_line_items: number;
  total_units: number;
  skipped_orders: SkippedReleaseOrder[];
}

export function useOrderPool() {
  return useQuery<OrderPool>({
    queryKey: ['wms', 'order-pool'],
    queryFn: async () => {
      const { data } = await axiosInstance.get('/api/v1/wms/order-pool');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useSetPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, flagged }: { orderId: string; flagged: boolean }) => {
      await axiosInstance.post(`/api/v1/wms/orders/${orderId}/priority`, { flagged });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wms', 'order-pool'] });
    },
  });
}

/**
 * useBulkSetPriority (THREAD B, 2026-06-30)
 * ------------------------------------------
 * Consolidated bulk endpoint (ON-01, /api/v1/modules/order-nexus/prioritise)
 * — now carries the same pool-membership guard the singular WMS endpoint
 * has always had. Deliberately additive, not a replacement for
 * useSetPriority: that hook is still used by ReleaseQueuePage and
 * OrderFlowPage, neither audited as part of this change. Only
 * OrdersFT2Page's onPriorityFlag (N-call Promise.all loop) is being
 * migrated to this single bulk call.
 */
export function useBulkSetPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderIds: string[]) => {
      await axiosInstance.post('/api/v1/modules/order-nexus/prioritise', {
        order_ids: orderIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wms', 'order-pool'] });
      // THREAD B FIX (2026-06-30): the Orders Overview button reverted
      // from "Prioritized ✓" back to "Prioritize →" after 2s — confirmed
      // live. Root cause: order.isPriorityFlagged comes from
      // useOrdersOperatorSummary's ['order-nexus', 'operator-summary']
      // query, never invalidated here, so the persistent flag never
      // actually refreshed — only the local 2s transient state was
      // ever true. Backend write itself was correct the whole time
      // (confirmed visible in Order Flow).
      qc.invalidateQueries({ queryKey: ['order-nexus', 'operator-summary'] });
    },
  });
}

export function useReleaseBatch() {
  const qc = useQueryClient();

  return useMutation<ReleaseBatchResult, Error, ReleaseBatchPayload>({
    mutationFn: async (payload) => {
      const { data } = await axiosInstance.post('/api/v1/wms/batch/release', payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wms', 'order-pool'] });
      qc.invalidateQueries({ queryKey: ['wms', 'batches'] });
    },
  });
}
