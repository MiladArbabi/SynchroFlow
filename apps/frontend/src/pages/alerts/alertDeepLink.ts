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
};

export function alertDeepLink(alert: Alert): { route: string; label: string } | null {
  const base = ALERT_ROUTE_MAP[alert.alert_type];
  if (!base) return null;
  if (alert.entity_id && alert.entity_type === 'variant' &&
    (alert.alert_type === 'stockout_risk' || alert.alert_type === 'reorder_warning')) {
    return { route: `${base.route}?variantId=${alert.entity_id}`, label: base.label };
  }
  return base;
}
