// apps/frontend/src/pages/orders/useConstrainedOrders.ts

import { useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { isApproachingFulfillmentSla } from '@lasyncro/shared/contracts/fulfillment-sla';

/**
 * OPERATOR VOCABULARY TRANSLATION (B-04)
 * ---------------------------------------
 * System constraint types are NEVER exposed to operators.
 * Always translate to operator-facing language.
 *
 * system → operator
 * operational → Operational hold
 * inventory  → Out of Stock
 * customer   → Address Issue
 *
 * RETURNS-BOUNDARY-01 (2026-09-14): 'operational' was previously labeled
 * 'Pick Exception', on the assumption that the evaluator's only live
 * signal was a physical pick exception. That assumption is now wrong on
 * two counts: (1) operationalConstraintEvaluator.ts is permanently inert
 * (BL-01b) — no pick exception can produce this constraint_type today —
 * and (2) the dominant real producer of an active 'operational' row is
 * returned_undelivered (returnJobs.service.ts), which is an internal
 * Order Pool release guard, not a pick exception, and is filtered out of
 * OrderFlowPage's Blocked Orders entirely (see OrderFlowPage.tsx). This
 * label is therefore now a neutral fallback for the rare case an
 * 'operational' row reaches this page with SOME OTHER real blocker also
 * active on the order (FLOW-MULTIBLOCK-01 keeps such rows visible) — it
 * must not claim a specific cause the data does not support. See
 * operationalConstraintEvaluator.ts.
 */
export const CONSTRAINT_LABELS: Record<string, string> = {
  operational: 'Operational hold',
  inventory: 'Out of Stock',
  customer: 'Address Issue',
};

export function getConstraintLabel(constraintType: string): string {
  return CONSTRAINT_LABELS[constraintType] ?? 'Needs Attention';
}

/**
 * BLOCKER REASON — OPERATOR SENTENCE (BL-02a, 2026-08-09)
 * -------------------------------------------------------
 * Says what is wrong, in plain SMB-operator English, derived ONLY from
 * canonical order_constraints fields (constraint_type + block_type).
 *
 * WHY NOT recommended_action: OrderFlowPage previously rendered
 * recommended_action.type and fell back to the literal string
 * 'Manual review required' when no decision existed. Production has
 * decision=null on every blocked order, so all nine cards showed a
 * workflow that does not exist. Same class as BL-15/BL-16 — decisions
 * are enrichment, order_constraints is truth.
 *
 * WHY NOT the raw type: CONSTRAINT_LABELS' contract is that system
 * vocabulary is never shown to operators. '.replace(/_/g, " ")' on
 * 'resolve_customer_block' violated it.
 *
 * INVENTORY WORDING IS DELIBERATELY CONSERVATIVE (BL-02a-FU-01):
 * 'Not enough stock to fulfill' is true regardless of how
 * available_quantity / reserved_quantity / on_hand_quantity resolve.
 * Stronger wording ('Oversold') must wait for BLOCKED-INV-01.
 */
export function getBlockerReason(order: ConstrainedOrder): string {
  if (order.constraint_type === 'customer') {
    return order.block_type === 'incomplete_address'
      ? 'Shipping address incomplete'
      : 'Customer details need attention';
  }
  if (order.constraint_type === 'inventory') {
    return 'Not enough stock to fulfill';
  }
  if (order.constraint_type === 'operational') {
    // DR-03B2-CORRECTION §3: Order Flow must ignore the Returns condition
    // for merchant-facing diagnosis ENTIRELY — not just avoid saying
    // "Package returned"/"returned_undelivered", but never surface
    // "Operational hold" for it either. When this row survives
    // OrderFlowPage's returned_undelivered filter solely because another
    // real blocker (other_blocker_types) is also active, show that genuine
    // blocker's reason instead, following the same customer > inventory
    // precedence the server already uses to elect the primary constraint.
    // other_blocker_types carries only the constraint TYPE, not its exact
    // block_type, so the reason here is the coarser per-type wording
    // (matching CONSTRAINT_LABELS) — honest, not invented detail. A
    // returned_undelivered-ONLY order never reaches this component at all
    // (OrderFlowPage filters it out before render), so the fallback below
    // is defensive, not the expected path.
    if (order.block_type === 'returned_undelivered') {
      const others = order.other_blocker_types ?? [];
      if (others.includes('customer')) return 'Customer details need attention';
      if (others.includes('inventory')) return 'Not enough stock to fulfill';
      return 'Operational hold';
    }
    return 'Operational hold';
  }
  return 'Needs attention';
}

/**
 * SECONDARY BLOCKERS — FLOW-MULTIBLOCK-01 (2026-08-13)
 * ----------------------------------------------------
 * An order can hold several active constraints at once. The card shows
 * ONE — the elected constraint, chosen by fixed precedence in
 * orders.constrained.controller.ts (operational > customer > inventory).
 *
 * WHY THIS EXISTS: locally 9 of 19 blocked orders held both a customer
 * and an inventory constraint. The operator saw one, resolved it, and
 * the order did not move — the other blocker was never surfaced. That
 * is the same failure shape as the Shopify reviewer's rejection: an
 * action that appears to work and produces no visible progress.
 *
 * WHY NAMED, NOT COUNTED: '+1 more' tells the operator a number.
 * 'Also: not enough stock' tells them why their next action will not
 * release the order. The point is to prevent a wasted action.
 *
 * Reuses CONSTRAINT_LABELS — system vocabulary is never shown raw.
 * Returns null when the elected constraint is the only one, so the
 * caller branches on null rather than on an empty string.
 */
export function getSecondaryBlockers(order: ConstrainedOrder): string | null {
  const others = order.other_blocker_types ?? [];
  if (others.length === 0) return null;

  const labels = others.map((type) => CONSTRAINT_LABELS[type] ?? 'Needs Attention');
  return `Also: ${labels.join(' · ')}`;
}

export type ConstrainedOrder = {
  sla_state?: 'normal' | 'approaching' | 'breached' | null;
  is_priority_flagged?: boolean;
  order_id: string;
  external_order_id: string | null;
  constraint_type: string;
  block_type: string | null;
  target_id?: string | null;
  target_status?: string | null;
  /**
   * FLOW-MULTIBLOCK-01: other active constraint types on this order,
   * excluding constraint_type above. Backend COALESCEs to an empty
   * array, never null — the optional marker covers older cached
   * responses only.
   */
  other_blocker_types?: string[];
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
  age_since_paid_seconds: number | null;
  fulfillment_sla_hours: number | null;
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
 * warning  → amber inside the canonical approaching-Fulfillment-SLA window
 * ok       → green
 *
 * SLA-SEM-01:
 * warning uses paid age + merchant fulfillment_sla_hours only.
 * Creation-age Watch/Aging is a separate operational concept.
 */
export type SlaProximity = 'breached' | 'warning' | 'ok';

export function getSlaProximity(order: ConstrainedOrder): SlaProximity {
  if (order.sla_state !== undefined) return order.sla_state === 'breached' ? 'breached' : order.sla_state === 'approaching' ? 'warning' : 'ok';
  if (order.is_shipping_sla_breached || order.is_delivery_sla_breached) {
    return 'breached';
  }
  if (
    isApproachingFulfillmentSla({
      ageSincePaidSeconds: order.age_since_paid_seconds,
      fulfillmentSlaHours: order.fulfillment_sla_hours,
    })
  ) {
    return 'warning';
  }

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
