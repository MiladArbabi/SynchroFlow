// apps/backend/src/services/inventory/purchaseOrderStatusGroups.ts
//
// STOCK-PROTECT-03 — canonical PO-status groupings.
// ============================================================================
// Four distinct concepts, deliberately kept as four separate constants and
// never collapsed into one:
//
//   RELIABLE_INBOUND_PO_STATUSES         — Demand arithmetic ONLY. Nets
//     against suggested_reorder_qty in demandIntelligence.service.ts. Draft
//     is deliberately excluded: an unplaced PO is not committed supply.
//
//   RECEIVING_BOUNDARY_PO_STATUSES       — dual role: participates in BOTH
//     Slice 1 treatment precedence (receive_inbound) AND Stock Protection
//     planning eligibility (a receiving-boundary PO is unfinished merchant
//     receiving work, capable of independently waking an otherwise-dormant
//     SKU). NOT a treatment-only grouping.
//
//   STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES — PO statuses capable of
//     independently establishing Stock Protection planning eligibility for
//     an otherwise dormant SKU: draft (unfinished merchant replenishment
//     work) plus the receiving boundary (unfinished merchant receiving
//     work). Deliberately EXCLUDES ordered/confirmed/in_production — a
//     committed, pre-arrival PO is pure supplier-side wait state with no
//     unfinished merchant task of its own, and must never by itself wake a
//     dormant SKU (STOCK-PROTECT-03 eligibility correction).
//
//   ACTIVE_REPLENISHMENT_PO_STATUSES     — the raw evidence-classification
//     superset consumed by stockProtectionMonitoring.ts's four action-
//     evidence booleans. NEVER used to establish planning eligibility.
//
// received / cancelled purchase_orders are resolved history and appear in
// none of these groups.

export const RELIABLE_INBOUND_PO_STATUSES = ['ordered', 'confirmed', 'in_production'] as const;

export const RECEIVING_BOUNDARY_PO_STATUSES = ['shipped', 'partially_received'] as const;

export const STOCK_PROTECTION_ELIGIBILITY_PO_STATUSES = [
  'draft',
  ...RECEIVING_BOUNDARY_PO_STATUSES,
] as const;

export const ACTIVE_REPLENISHMENT_PO_STATUSES = [
  'draft',
  ...RELIABLE_INBOUND_PO_STATUSES,
  ...RECEIVING_BOUNDARY_PO_STATUSES,
] as const;
