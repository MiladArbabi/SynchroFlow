// apps/frontend/src/pages/orders/useOrderDecision.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { ConstrainedOrdersResponse } from './useConstrainedOrders';

export type OrderDecision = {
  decision: {
    id: string;
    type: string;
    entity_id: string;
    status: string;
    priority: number;
    reason: string;
    recommended_action: {
      type: string;
      payload: Record<string, unknown>;
      execution_mode: 'manual' | 'automated';
    };
    actions: Array<{
      type: string;
      payload: Record<string, unknown>;
      execution_mode: 'manual' | 'automated';
    }>;
    lifecycle: {
      started_at: string | null;
      resolved_at: string | null;
      outcome: 'success' | 'failure' | null;
    } | null;
    created_at: string;
    updated_at: string;
  };
  constraints: Array<{
    constraint_type: string;
    block_type: string | null;
    started_at: string | null;
  }>;
};

export type ExecuteResult = {
  message: string;
  decision_id: string;
  action_type: string;
};

/**
 * useOrderDecision
 * ----------------
 * Fetches current decision state for a single order.
 * Enabled only when orderId is provided.
 */
export function useOrderDecision(orderId: string | null) {
  return useQuery<OrderDecision>({
    queryKey: ['orders', 'decision', orderId],
    queryFn: async () => {
      const { data } = await axiosInstance.get(
        `/api/v1/orders/${orderId}/decision`
      );
      return data;
    },
    enabled: !!orderId,
  });
}

/**
 * useExecuteOrderDecision (B-03)
 * ------------------------------
 * Triggers execution of the recommended decision action for an order.
 *
 * OPTIMISTIC UPDATE STRATEGY:
 * - On mutate: immediately invalidate constrained orders query
 *   so the UI reflects the action without waiting for server round-trip
 * - On settle: re-fetch to reconcile against real snapshot state
 *
 * The operator sees the result instantly.
 * Discrepancies are resolved silently in the background.
 */
export function useExecuteOrderDecision() {
  const queryClient = useQueryClient();

  return useMutation<ExecuteResult, Error, string>({
    mutationFn: async (orderId: string) => {
      const { data } = await axiosInstance.post(
        `/api/v1/orders/${orderId}/execute`
      );
      return data;
    },

    onMutate: async (orderId) => {
      /**
       * OPTIMISTIC UPDATE (B-03)
       * ------------------------
       * Cancel in-flight refetches to prevent overwrite.
       * Snapshot the current cache for rollback on error.
       */
      await queryClient.cancelQueries({
        queryKey: ['orders', 'constrained'],
      });

      const previous = queryClient.getQueryData(['orders', 'constrained']);

      /**
       * Optimistically remove the order from the constrained list.
       * If execution fails, the rollback below restores it.
       */
      queryClient.setQueriesData(
        { queryKey: ['orders', 'constrained'] },
        (old: ConstrainedOrdersResponse | undefined) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.filter(
              (o: { order_id: string }) => o.order_id !== orderId
            ),
          };
        }
      );

      return { previous };
    },

    onError: (_err, _orderId, context: { previous: ConstrainedOrdersResponse | undefined } | undefined) => {
      /**
       * ROLLBACK on failure — restore previous cache state.
       */
      if (context?.previous) {
        queryClient.setQueryData(['orders', 'constrained'], context.previous);
      }
    },

    onSettled: (_data, _error, orderId) => {
      /**
       * IMMEDIATE invalidation — catches fast execution paths.
       * Added 2026-06-28: ['order-detail', orderId] — the EntityDetailModal
       * merges this query with this hook's own decision data; without this,
       * the modal's fulfillment-status section shows stale data after
       * "Mark as Resolved" until manually closed/reopened.
       */
      queryClient.invalidateQueries({ queryKey: ['orders', 'constrained']});
      queryClient.invalidateQueries({ queryKey: ['order-nexus', 'ft2'] });
      queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });

      /**
       * DELAYED invalidation (C-03)
       * ---------------------------
       * The snapshot dispatcher has a 2s delay guard before recomputing.
       * A second invalidation at 4s catches the recomputed snapshot,
       * ensuring the UI reflects post-execution state accurately.
       *
       * This eliminates the need for manual refresh after execution.
       */
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['orders', 'constrained'] });
        queryClient.invalidateQueries({ queryKey: ['order-nexus', 'ft2'] });
        queryClient.invalidateQueries({ queryKey: ['order-detail', orderId] });
      }, 4000);
    },
  });
}