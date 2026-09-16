// apps/frontend/src/pages/alerts/alertDeepLink.ts
//
// OPS-CONSOLE-01 — canonical alert deep-link resolver.
//
// Extracted verbatim from TopnavbarContent.tsx, where the map only lived
// because the alerts bell popover rendered there. The bell UI is gone; the
// routing is not. This is the smallest neutral home for it: it sits beside
// useAlerts.ts, the alert data seam, and depends on nothing but the Alert type
// so any surface can consume it without importing a layout.
//
// alert_type is always underscore-delimited (set by all producers).
// alert_key is colon-delimited and was the source of the original mismatch.
// Entity-aware: appends entity_id where the destination UI can consume it.

import type { Alert } from './useAlerts';

export const ALERT_ROUTE_MAP: Record<string, { route: string; label: string }> = {
  wms_pick_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_pack_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_stow_pending:        { route: '/wms',            label: 'Warehouse' },
  wms_stow_exception:      { route: '/problem-center', label: 'Problem Center' },
  wms_batch_ready_to_pack: { route: '/wms',            label: 'Warehouse' },
  wms_batch_ready_to_ship: { route: '/wms',            label: 'Warehouse' },
  wms_batch_released:      { route: '/wms',            label: 'Warehouse' },
  wms_receive_arrived:     { route: '/wms',            label: 'Warehouse' },
  wms_receive_exception:   { route: '/problem-center', label: 'Problem Center' },
  inventory_reconciliation_conflict: { route: '/problem-center', label: 'Problem Center' },
  // FIX (2026-06-30): was routing to /demand — Sourcing module didn't
  // exist when this was written. Real path confirmed in
  // purchasingSubTabs.ts. alertDeepLink() already appends ?variantId=
  // for this alert type; Sourcing's v1 build (sourcing-recommendation-
  // playbook.md §6) should read that param to scope directly to the
  // flagged variant once implemented.
  stockout_risk:           { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
  // Currently dead — nothing in the backend creates this alert type yet
  // (confirmed via repo-wide search, 2026-06-30). Routed alongside
  // stockout_risk in anticipation of DF-03 (proactive, velocity-based
  // reorder signal — see MVP Roadmap, still 🔴 OPEN). When built, this
  // is where it should land.
  reorder_warning:         { route: '/suppliers-portal/sourcing', label: 'Sourcing' },
  revenue_at_risk:         { route: '/overview',      label: 'Overview' },
  operational:             { route: '/orders',         label: 'Orders' },
  sla_breach:              { route: '/orders',         label: 'Orders' },
  missing_cogs:            { route: '/inventory/costs', label: 'Costs' },
  billing_usage_threshold: { route: '/settings/billing', label: 'Billing' },

  // ── OPS-CONSOLE-02: three previously unmapped families ────────────────────
  // These had no destination, so the Ops Console rendered them as dead ends.
  // Routes and labels are NOT invented here: they are the existing repository
  // truth from apps/backend/src/services/overview-ft2/overviewMorningBrief
  // .resolver.ts (ACTION_LABEL_MAP + DEEP_LINK_MAP), which already ships these
  // exact label/route pairs for the morning brief. Labels here are
  // job-to-be-done rather than destination names, matching that resolver.
  //
  // `inventory` is the SHOP-LEVEL aggregate (entity_type='shop',
  // entity_id=null): it does not name the affected variant or order, so it must
  // NOT be routed to targeted Sourcing. It lands on the constrained-order list,
  // where the merchant picks the actual order. Targeted Sourcing remains the
  // job of the existing per-order inventory treatment, which has the constraint
  // context this alert lacks.
  // Label is 'Resolve stockouts', not 'Review stock': the destination is the
  // resolution queue (Blocked Orders -> Out of Stock), not a stock report.
  // Reviewing levels in Catalog cannot identify WHICH products blocked these
  // orders, so the CTA names the job the destination actually performs.
  inventory:               { route: '/orders/flow?constraint=inventory', label: 'Resolve stockouts' },
  customer:                { route: '/overview?resolution=address',       label: 'Fix addresses' },
  // Shop-level low-stock summary from the AL-01 aggregator. Kept SEPARATE from
  // stockout_risk (per-variant, order-triggered) and from `inventory`
  // (order-blocking): three different operational states that happen to share a
  // landing page with stockout_risk. Not merged.
  low_stock_reorder:       { route: '/demand?filter=critical',            label: 'Reorder now' },
};

/**
 * STOCK-PROTECT-03 Slice 3B: a backend-derived `alert.action` ALWAYS takes
 * precedence over the static ALERT_ROUTE_MAP below — this is how
 * alert_type='stock_protection' rows resolve to a real destination without
 * this file ever re-deriving treatment or inventing a route. There is
 * deliberately no 'stock_protection' entry in ALERT_ROUTE_MAP: a
 * stock_protection row with `action: null` (no capable destination right
 * now — complete_setup, commercial denial, resolved, or an unresolved
 * treatment) falls through to `ALERT_ROUTE_MAP[alert.alert_type]`, finds
 * nothing, and correctly returns null. Do not add one.
 */
export function alertDeepLink(alert: Alert): { route: string; label: string } | null {
  if (alert.action) {
    return { route: alert.action.route, label: alert.action.label };
  }

  const base = ALERT_ROUTE_MAP[alert.alert_type];
  if (!base) return null;
  if (alert.entity_id && alert.entity_type === 'variant' &&
    (alert.alert_type === 'stockout_risk' || alert.alert_type === 'reorder_warning')) {
    return { route: `${base.route}?variantId=${alert.entity_id}`, label: base.label };
  }
  return base;
}
