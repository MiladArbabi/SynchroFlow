// apps/frontend/src/pages/ft2-pages/orderPoolSorting.ts
//
// ORDER POOL VISUAL ORDERING (ORD-DECISION-01 / Slice 3A)
// ------------------------------------------------------
// The Order Pool's release ranking is owned by the backend, which returns
// rows already ordered by:
//
//   is_priority_flagged DESC, SLA rank (breached > approaching > normal) DESC,
//   order_created_at ASC
//
// (wms.controller.ts httpGetOrderPool / pickBatch.service.ts releaseBatch —
// the two share the identical sort so the table cannot disagree with what a
// wave release would actually pick up.)
//
// OrderFlowPage lets the operator re-sort the pool table by Age / Value /
// Lines / Units. That operator preference is a TIEBREAKER, not a replacement:
// it may only reorder rows *within* a Priority/SLA tier. Sorting the whole
// list by the chosen field alone silently reverses the backend's urgency
// ranking — an SLA-breached order can be pushed below a calm one purely
// because it is younger — which contradicts the approved decision contract
// that SLA breach is prioritisation.
//
// SLA breach never blocks and never releases anything; it only ranks. This
// module is the single place that ranking is expressed on the client.
//
// Extracted from OrderFlowPage.tsx as a pure function so the invariant is
// testable without mounting the 3-column board.

export type PoolSortField = 'age' | 'value' | 'lines' | 'units';

/**
 * The fields the pool comparator actually reads. Deliberately a structural
 * subset of PoolOrder (useOrderPool.ts) so callers stay compatible and tests
 * do not have to construct unrelated row shape.
 */
export interface PoolSortableOrder {
  order_created_at: string;
  total_price: string;
  line_item_count: number;
  unit_count: number;
  is_priority_flagged: boolean;
  is_shipping_sla_breached: boolean | null;
  sla_state?: string | null;
}

/** Merchant priority > server-assessed SLA urgency > operator tie-break. */
export function poolUrgencyTier(order: PoolSortableOrder): number {
  const slaRank = order.sla_state === 'breached' || (order.sla_state === undefined && order.is_shipping_sla_breached) ? 2 : order.sla_state === 'approaching' ? 1 : 0;
  return (order.is_priority_flagged ? 3 : 0) + slaRank;
}

/**
 * Comparator for the Order Pool table.
 *
 * Urgency tier always wins and is never inverted by sortDir — flipping the
 * Age arrow must not promote calm orders above breached ones. The operator's
 * field/direction applies only inside a tier.
 */
export function comparePoolOrders<T extends PoolSortableOrder>(
  sortField: PoolSortField,
  sortDir: 'asc' | 'desc',
): (a: T, b: T) => number {
  return (a, b) => {
    const tier = poolUrgencyTier(b) - poolUrgencyTier(a);
    if (tier !== 0) return tier;

    let cmp = 0;
    switch (sortField) {
      case 'age':
        cmp = new Date(a.order_created_at).getTime() - new Date(b.order_created_at).getTime();
        break;
      case 'value':
        cmp = Number(a.total_price) - Number(b.total_price);
        break;
      case 'lines':
        cmp = a.line_item_count - b.line_item_count;
        break;
      case 'units':
        cmp = a.unit_count - b.unit_count;
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  };
}
