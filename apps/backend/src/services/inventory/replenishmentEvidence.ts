// apps/backend/src/services/inventory/replenishmentEvidence.ts
//
// STOCK-PROTECT-03 — shared raw active-replenishment-evidence reader.
// ============================================================================
// Pure existence/status reads only — NO treatment derivation, NO urgency
// derivation, NO eligibility policy beyond selecting the raw active-evidence
// universe. This is the single place that queries reorder_requests and
// purchase_order_line_items/purchase_orders for "what's currently active,"
// consumed by BOTH:
//   - demandIntelligence.service.ts's stock_protection eligibility mode
//     (signals E/F), and
//   - stockProtectionMonitoring.ts's action-evidence classification
// without either of those two depending on each other (avoids the
// monitoring -> planning -> monitoring cycle).
//
// Caller supplies the Knex.Transaction and owns tenant scope, exactly like
// computeVariantPlanning — no global DB fallback, no cross-shop reads.
// received/cancelled purchase_orders and dismissed/converted
// reorder_requests are deliberately excluded: resolved history, not active
// evidence.

import type { Knex } from 'knex';
import { ACTIVE_REPLENISHMENT_PO_STATUSES } from './purchaseOrderStatusGroups.js';

export type ActiveReplenishmentEvidence = {
  pendingReorderRequestVariantIds: ReadonlySet<string>;
  poStatusesByVariant: ReadonlyMap<string, ReadonlySet<string>>;
};

export async function getActiveReplenishmentEvidence(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[],
): Promise<ActiveReplenishmentEvidence> {
  const pendingRows: Array<{ lasyncro_variant_id: string }> = await trx('reorder_requests')
    .where('shop_id', shopId)
    .andWhere('status', 'pending')
    .modify((qb: Knex.QueryBuilder) => {
      if (variantIds?.length) qb.whereIn('lasyncro_variant_id', variantIds);
    })
    .distinct('lasyncro_variant_id');

  const pendingReorderRequestVariantIds = new Set(pendingRows.map((r) => r.lasyncro_variant_id));

  const poRows: Array<{ lasyncro_variant_id: string | null; status: string }> = await trx(
    'purchase_order_line_items as poli',
  )
    .join('purchase_orders as po', 'po.id', 'poli.po_id')
    .where('po.shop_id', shopId)
    .whereIn('po.status', [...ACTIVE_REPLENISHMENT_PO_STATUSES])
    .modify((qb: Knex.QueryBuilder) => {
      if (variantIds?.length) qb.whereIn('poli.lasyncro_variant_id', variantIds);
    })
    .whereNotNull('poli.lasyncro_variant_id')
    .distinct('poli.lasyncro_variant_id', 'po.status');

  const poStatusesByVariant = new Map<string, Set<string>>();
  for (const row of poRows) {
    if (!row.lasyncro_variant_id) continue;
    const statuses = poStatusesByVariant.get(row.lasyncro_variant_id) ?? new Set<string>();
    statuses.add(row.status);
    poStatusesByVariant.set(row.lasyncro_variant_id, statuses);
  }

  return { pendingReorderRequestVariantIds, poStatusesByVariant };
}
