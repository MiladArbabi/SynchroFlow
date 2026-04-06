// apps/frontend/src/pages/orders/useConstrainedOrders.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';

/**
 * OPERATOR VOCABULARY TRANSLATION (B-04)
 * ---------------------------------------
 * System constraint types are NEVER exposed to operators.
 * Always translate to operator-facing language.
 *
 * system → operator
 * operational → Overdue
 * inventory  → Out of Stock
 * customer   → Address Issue
 */
export const CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Overdue',
  inventory: 'Out of Stock',
  customer: 'Address Issue',
};

export function getConstraintLabel(constraintType: string): string {
  return CONSTRAINT_LABELS[constraintType] ?? 'Needs Attention';
}

export type ConstrainedOrder = {
  order_id: string;
  constraint_type: string;
  block_type: string | null;
  constrained_since: string | null;
  revenue: number | null;
  recommended_action: {
    type: string;
    payload: Record<string, unknown>;
    execution_mode: 'manual' | 'automated';
  } | null;
  priority: number | null;
  decision_id: string | null;
};

export type ConstrainedOrdersResponse = {
  data: ConstrainedOrder[];
  pagination: {
    page: number;
    limit: number;
  };
};

/**
 * useConstrainedOrders
 * --------------------
 * Fetches paginated list of constrained orders for the Fulfillment Queue.
 *
 * Rules:
 * - Read-only
 * - No transformation — pure passthrough from backend
 * - constraint_type filter optional
 */
export function useConstrainedOrders(options?: {
  page?: number;
  limit?: number;
  constraint_type?: string;
}) {
  const { page = 1, limit = 50, constraint_type } = options ?? {};

  return useQuery<ConstrainedOrdersResponse>({
    queryKey: ['orders', 'constrained', { page, limit, constraint_type }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(constraint_type ? { constraint_type } : {}),
      });
      const { data } = await axiosInstance.get(
        `/api/v1/orders/constrained?${params}`
      );
      return data;
    },
    /**
     * LIVE QUEUE
     * -----------------
     * Refetch every 10s to keep the queue live without manual refresh.
     * Operators act on this data — it must stay current.
     *
     * 10s balances freshness vs server load.
     * After execution, invalidateQueries triggers an immediate refetch
     * on top of this interval.
     */
    refetchInterval: 10_000,
    /**
     * Keep previous data visible while refetching.
     * Prevents queue flickering on background refresh.
     */
    placeholderData: (prev) => prev,
  });
}