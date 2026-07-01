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
 * operational → Pick Exception
 * inventory  → Out of Stock
 * customer   → Address Issue
 *
 * 'operational' was previously labeled 'Overdue', which collided with the
 * unrelated CPT-bucket time indicator (also literally 'overdue') shown on
 * the same Blocked card. Renamed to reflect the evaluator's real signal —
 * a physical pick exception, not a time/SLA breach. See
 * operationalConstraintEvaluator.ts.
 */
export const CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Pick Exception',
  inventory: 'Out of Stock',
  customer: 'Address Issue',
};

export function getConstraintLabel(constraintType: string): string {
  return CONSTRAINT_LABELS[constraintType] ?? 'Needs Attention';
}

export type ConstrainedOrder = {
  order_id: string;
  external_order_id: string | null;
  constraint_type: string;
  block_type: string | null;
  constrained_since: string | null;
  revenue: number | null;
  promised_ship_by: string | null;
  recommended_action: {
    type: string;
    payload: Record<string, unknown>;
    execution_mode: 'manual' | 'automated';
  } | null;
  priority: number | null;
  decision_id: string | null;
  // SLA fields
  age_since_creation_seconds: number | null;
  is_shipping_sla_breached: boolean | null;
  is_delivery_sla_breached: boolean | null;
  gross_margin: number | null;
  margin_pct: number | null;
};

/**
 * CONSTRAINT SEVERITY MAPPING (2026-07-01)
 * -----------------------------------------
 * order_constraints carries no severity field of its own — this is a
 * design judgment layered on top, following the same rail+icon+label
 * pattern already established in TopnavbarContent.tsx's BellAlertRow
 * (AlertsModule.md D5: severity communicated by icon+color+label, never
 * colour alone). Not derived from data — a deliberate choice, documented
 * here so it isn't mistaken for a confirmed backend signal.
 */
export type ConstraintSeverity = 'critical' | 'warning';

export const CONSTRAINT_SEVERITY: Record<string, ConstraintSeverity> = {
  inventory: 'critical',
  operational: 'critical',
  customer: 'warning',
};

export function getConstraintSeverity(constraintType: string): ConstraintSeverity {
  return CONSTRAINT_SEVERITY[constraintType] ?? 'warning';
}

/**
 * SLA_PROXIMITY
 * -------------
 * Derives color-coded urgency from age and SLA breach flags.
 * Used to sort and color orders in FulfillmentQueue.
 *
 * breached → red
 * warning  → amber (>75% of 48h threshold)
 * ok       → green
 */
export type SlaProximity = 'breached' | 'warning' | 'ok';

export function getSlaProximity(order: ConstrainedOrder): SlaProximity {
  if (order.is_shipping_sla_breached || order.is_delivery_sla_breached) {
    return 'breached';
  }
  const ageHours = (order.age_since_creation_seconds ?? 0) / 3600;
  if (ageHours >= 36) return 'warning'; // 75% of 48h threshold
  return 'ok';
}

export function getAgeLabel(order: ConstrainedOrder): string {
  const seconds = order.age_since_creation_seconds ?? 0;
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

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