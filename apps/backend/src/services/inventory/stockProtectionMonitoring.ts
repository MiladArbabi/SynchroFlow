// apps/backend/src/services/inventory/stockProtectionMonitoring.ts
//
// STOCK-PROTECT-03 Slice 2 — dark monitoring/evidence service.
// ============================================================================
// Combines the canonical Demand planning authority (computeVariantPlanning)
// with reorder/PO action evidence and feeds both into the approved pure
// Slice 1 rule (deriveStockProtectionTreatment). DARK: writes nothing and is
// not called from any alert/worker/controller/execution-handler path yet.
//
// computeVariantPlanning remains the ONLY authority for reorder_urgency,
// suggested_reorder_qty, velocity/planning arithmetic, effective Stock
// Protection Policy, pickable availability, and reliable-inbound netting.
// This module never re-derives urgency, never recomputes suggested_reorder_qty,
// and never subtracts committed/incoming quantity again — Demand's own
// "reliable inbound" already nets committed-PO quantity into
// suggested_reorder_qty for a different purpose (sizing the suggestion), not
// for classifying "does a committed PO exist" as evidence, which is all this
// module adds.
//
// Caller supplies the Knex.Transaction and owns tenant scope (SET LOCAL
// app.current_tenant) exactly like computeVariantPlanning — no global DB
// fallback, no cross-shop reads. Every evidence query below filters shop_id
// explicitly (redundant with RLS by the same convention used throughout
// demandIntelligence.service.ts).

import type { Knex } from 'knex';
import { computeVariantPlanning } from '../demand/demandIntelligence.service.js';
import {
  RELIABLE_INBOUND_PO_STATUSES,
  RECEIVING_BOUNDARY_PO_STATUSES,
} from './purchaseOrderStatusGroups.js';
import {
  getActiveReplenishmentEvidence,
  type ActiveReplenishmentEvidence,
} from './replenishmentEvidence.js';
import {
  deriveStockProtectionTreatment,
  type ReorderUrgency,
  type StockProtectionActionEvidence,
  type StockProtectionTreatment,
} from './stockProtectionTreatment.js';

export type StockProtectionMonitoringResult = {
  lasyncro_variant_id: string;
  treatment: StockProtectionTreatment;
  reorder_urgency: ReorderUrgency;
  suggested_reorder_qty: number | null;
};

const EMPTY_EVIDENCE: Readonly<StockProtectionActionEvidence> = Object.freeze({
  hasPendingReorderRequest: false,
  hasDraftPo: false,
  hasCommittedPo: false,
  hasReceivingBoundaryPo: false,
});

/**
 * Pure classifier: turns a raw ActiveReplenishmentEvidence snapshot into the
 * four per-variant treatment-input booleans. No DB access — every caller
 * (standalone getStockProtectionActionEvidence, or evaluateStockProtection
 * ForShop reusing its single canonical read) supplies the snapshot.
 */
export function classifyStockProtectionActionEvidence(
  evidence: ActiveReplenishmentEvidence,
): Map<string, StockProtectionActionEvidence> {
  const evidenceMap = new Map<string, StockProtectionActionEvidence>();

  const ensure = (variantId: string): StockProtectionActionEvidence => {
    let entry = evidenceMap.get(variantId);
    if (!entry) {
      entry = { ...EMPTY_EVIDENCE };
      evidenceMap.set(variantId, entry);
    }
    return entry;
  };

  for (const variantId of evidence.pendingReorderRequestVariantIds) {
    ensure(variantId).hasPendingReorderRequest = true;
  }

  for (const [variantId, statuses] of evidence.poStatusesByVariant) {
    const entry = ensure(variantId);
    if (statuses.has('draft')) entry.hasDraftPo = true;
    if (RELIABLE_INBOUND_PO_STATUSES.some((s) => statuses.has(s))) entry.hasCommittedPo = true;
    if (RECEIVING_BOUNDARY_PO_STATUSES.some((s) => statuses.has(s))) entry.hasReceivingBoundaryPo = true;
  }

  return evidenceMap;
}

/**
 * Batched action-evidence lookup. Exported separately from
 * evaluateStockProtectionForShop so evidence classification (pending
 * reorder_requests, draft/committed/receiving-boundary purchase_orders) can
 * be exercised directly against DB fixtures without also having to
 * construct a full Demand planning scenario for every PO status — see the
 * Slice 2 test suite for the test-economy rationale.
 *
 * received / cancelled purchase_orders and dismissed / converted
 * reorder_requests are deliberately excluded: they are resolved history, not
 * active action evidence.
 *
 * EMPTY-ARRAY CONTRACT (Stock Protection monitoring API only — does not
 * change computeVariantPlanning's own generic semantics): `variantIds === []`
 * means "evaluate nothing" and returns an empty Map immediately, without
 * issuing either evidence query. This is deliberately stricter than
 * computeVariantPlanning's own `variantIds?.length` guard (where `[]` and
 * `undefined` both mean "no filter") — a safety boundary for future scoped
 * callers such as resolve_inventory_block, where an accidentally-empty scope
 * must never silently widen into a full-shop evaluation.
 *
 * This standalone entry point performs its own raw-evidence read (one call
 * to getActiveReplenishmentEvidence, i.e. the same 2 batched queries) — it
 * is NOT called by evaluateStockProtectionForShop, which instead loads
 * evidence once itself and calls classifyStockProtectionActionEvidence
 * directly, to preserve the one-canonical-read-per-evaluation invariant.
 */
export async function getStockProtectionActionEvidence(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
): Promise<Map<string, StockProtectionActionEvidence>> {
  if (variantIds !== undefined && variantIds.length === 0) {
    return new Map();
  }

  const evidence = await getActiveReplenishmentEvidence(trx, shopId, variantIds);
  return classifyStockProtectionActionEvidence(evidence);
}

/**
 * Evaluates canonical Stock Protection treatment for a shop, or a scoped
 * subset of variants. DARK — read-only, writes nothing, not wired into any
 * alert/worker/controller/execution-handler path in this slice.
 *
 * Query shape: exactly one computeVariantPlanning call PLUS one canonical
 * getActiveReplenishmentEvidence read (one batched reorder-request query,
 * one batched PO evidence query — 2 evidence queries total), regardless of
 * how many variants are planned — no per-variant queries. That single
 * evidence snapshot feeds BOTH computeVariantPlanning's stock_protection
 * eligibility test AND this function's action-evidence classification; it
 * is read exactly once, never reloaded.
 *
 * @param variantIds optional filter, with a Stock Protection-specific empty-
 *   array contract that is STRICTER than computeVariantPlanning's own:
 *     - `undefined`      -> evaluate the whole eligible catalogue.
 *     - `['v1', 'v2']`   -> evaluate only those variants.
 *     - `[]`             -> evaluate nothing; returns [] immediately,
 *                           without calling computeVariantPlanning or either
 *                           evidence query.
 *   computeVariantPlanning itself is untouched and keeps treating `[]` and
 *   `undefined` identically as "no filter" (demandIntelligence.service.ts's
 *   `variantIds?.length` guard) — the stricter "empty means nothing"
 *   contract is contained entirely inside this monitoring API, as a safety
 *   boundary for future scoped callers (e.g. resolve_inventory_block) where
 *   an accidentally-empty scope must never silently widen into a full-shop
 *   evaluation.
 */
export async function evaluateStockProtectionForShop(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
): Promise<StockProtectionMonitoringResult[]> {
  if (variantIds !== undefined && variantIds.length === 0) {
    return [];
  }

  const replenishmentEvidence = await getActiveReplenishmentEvidence(trx, shopId, variantIds);

  const planned = await computeVariantPlanning(trx, shopId, variantIds, {
    eligibilityMode: 'stock_protection',
    replenishmentEvidence,
  });
  if (planned.length === 0) return [];

  const evidenceMap = classifyStockProtectionActionEvidence(replenishmentEvidence);

  return planned.map((variant) => {
    const actionEvidence = evidenceMap.get(variant.lasyncro_variant_id) ?? EMPTY_EVIDENCE;
    const treatment = deriveStockProtectionTreatment({
      reorderUrgency: variant.reorder_urgency,
      suggestedReorderQty: variant.suggested_reorder_qty,
      actionEvidence,
    });

    return {
      lasyncro_variant_id: variant.lasyncro_variant_id,
      treatment,
      reorder_urgency: variant.reorder_urgency,
      suggested_reorder_qty: variant.suggested_reorder_qty,
    };
  });
}
