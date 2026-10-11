import { Knex } from 'knex';

/**
 * SHARED PURCHASING TRUTH (INV-TREAT-01)
 * --------------------------------------
 * Extracted verbatim from sourcingRecommendations.controller.ts so the Order
 * Detail inventory assist and the targeted Sourcing endpoint answer "what is
 * already coming" and "what is already being bought" from ONE definition.
 * Both callers now consume these helpers; the SQL is unchanged, deliberately,
 * so the existing sourcing contract (SRC-L3-07/08/09, SRC-ACT-BE-01/02) keeps
 * meaning exactly what it meant before the extraction.
 *
 * Everything here is READ-ONLY. Callers supply the transaction and must have
 * already established tenant context.
 */

/**
 * SRC-L3-07 — COMMITTED INBOUND STATUS DOMAIN
 * -------------------------------------------
 * Units already bought from a supplier and not yet received. Excluded:
 *   draft     — not yet placed with anyone, so nothing is coming
 *   received  — already landed, so it is in inventory_truth, not inbound
 *   cancelled — never arriving
 *
 * This is the MERCHANT-FACING "what is already coming" set. It is
 * intentionally NOT demandIntelligence's narrower, ETA-windowed "reliable
 * future inbound", which answers a different (planning) question. Two
 * questions, two definitions, both canonical — kept apart deliberately.
 */
// NULL retains legacy commitment arithmetic; it is not exact physical history.
// Known v2 values represent only explicitly scheduled later deliveries.
export function pendingDeliveryQuantitySql(alias = 'poli'): string {
  return `COALESCE(${alias}.quantity_pending_delivery, GREATEST(${alias}.quantity_ordered - ${alias}.quantity_received, 0))`;
}

export const COMMITTED_INBOUND_PO_STATUSES = [
  'ordered',
  'confirmed',
  'in_production',
  'shipped',
  'partially_received',
] as const;

/**
 * Open demand = units ordered but not yet fulfilled, VARIANT-WIDE across every
 * order in the tenant. order_revenue_units enforces
 * fulfilled_quantity <= quantity (CHECK constraint), so a fully shipped line
 * contributes 0 — no order-status filter is needed, and none exists on
 * `orders` anyway.
 */
export async function getVariantOpenDemandQty(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<number> {
  const row = await trx('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oru.lasyncro_variant_id', variantId)
    .sum({ demand: trx.raw('oru.quantity - oru.fulfilled_quantity') })
    .first();

  return Number(row?.demand ?? 0);
}

/**
 * SRC-L3-07/08 — COMMITTED INBOUND.
 *
 * Aggregated in its own query, never joined onto demand or inventory: a
 * variant with 3 open POs and 2 inventory rows would otherwise multiply
 * through a many-to-many join and inflate both sides.
 *
 * Remaining is clamped at zero so an over-receipt (received > ordered) cannot
 * subtract phantom units from the requirement.
 *
 * reorder_requests are NOT consulted: a queued request is buying intent pooled
 * for MOQ, with no supplier commitment and no ETA.
 */
export async function getCommittedInboundQty(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<number> {
  const row = await trx('purchase_order_line_items as poli')
    .join('purchase_orders as po', 'po.id', 'poli.po_id')
    .where('po.shop_id', shopId)
    .andWhere('poli.lasyncro_variant_id', variantId)
    .whereIn('po.status', COMMITTED_INBOUND_PO_STATUSES as unknown as string[])
    .sum({
      inbound: trx.raw(pendingDeliveryQuantitySql()),
    })
    .first();

  return Number(row?.inbound ?? 0);
}

/**
 * SRC-ACT-BE-01 — PENDING QUEUE INTENT.
 * Scoped to shop AND canonical variant explicitly. RLS already isolates the
 * tenant; the shop predicate is stated anyway so the query's grain is legible
 * at the call site rather than inferred from session state.
 *
 * WORKFLOW, NOT SUPPLY: it never enters committed inbound and never reduces
 * what still has to be sourced.
 */
export async function getPendingQueueQty(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<number> {
  const row = await trx('reorder_requests')
    .where({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      status: 'pending',
    })
    .sum({ qty: 'qty_requested' })
    .first();

  return Number(row?.qty ?? 0);
}

/**
 * SRC-ACT-BE-02 — DRAFT PURCHASING WORK.
 * The same GREATEST clamp as committed inbound, for the same reason: an
 * over-receipt must not subtract phantom units. Draft is the one PO status
 * that is prepared work rather than supply, which is exactly why it is
 * excluded from COMMITTED_INBOUND_PO_STATUSES and counted here.
 */
export async function getDraftPoQty(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string
): Promise<number> {
  const row = await trx('purchase_order_line_items as poli')
    .join('purchase_orders as po', 'po.id', 'poli.po_id')
    .where('po.shop_id', shopId)
    .andWhere('poli.lasyncro_variant_id', variantId)
    .andWhere('po.status', 'draft')
    .sum({
      qty: trx.raw(
        'GREATEST(poli.quantity_ordered - poli.quantity_received, 0)'
      ),
    })
    .first();

  return Number(row?.qty ?? 0);
}

/**
 * USABLE SUPPLIER OPTIONS — the same two branches the targeted Sourcing
 * endpoint builds its candidate list from, counted rather than listed:
 *
 *   §6a Branch A   active suppliers with PO history for THIS variant
 *   §7.8 Tier 1    active preferred suppliers matching the most specific
 *                  scope (variant > product > product_type)
 *
 * Counted as a distinct set because a supplier can qualify on both branches.
 * This answers only "does the merchant have anywhere to buy this", which is
 * what separates source_remaining from find_supplier. Supplier RANKING stays
 * where it is: sourcingRecommendations.controller.ts remains the authority on
 * scoring and ordering, and nothing here re-derives it.
 */
export async function countSupplierOptions(
  trx: Knex.Transaction,
  shopId: number,
  variantId: string,
  productId: string | null,
  productType: string | null
): Promise<number> {
  const historyRows = await trx('purchase_order_line_items as poli')
    .join('purchase_orders as po', 'po.id', 'poli.po_id')
    .join('suppliers as s', 's.id', 'po.supplier_id')
    .where('poli.lasyncro_variant_id', variantId)
    .andWhere('po.shop_id', shopId)
    .andWhere('s.active', true)
    .groupBy('s.id')
    .select('s.id');

  const preferredRows = await trx('supplier_product_preferences as spp')
    .join('suppliers as s', 's.id', 'spp.supplier_id')
    .where('spp.shop_id', shopId)
    .andWhere('s.active', true)
    .andWhere(function () {
      this.where({ 'spp.scope_type': 'variant', 'spp.scope_id': variantId })
        .orWhere({ 'spp.scope_type': 'product', 'spp.scope_id': productId ?? '' })
        .orWhere({
          'spp.scope_type': 'product_type',
          'spp.scope_id': productType ?? '',
        });
    })
    .groupBy('s.id')
    .select('s.id');

  const ids = new Set<number>();
  for (const row of [...historyRows, ...preferredRows]) {
    ids.add(Number((row as { id: number }).id));
  }

  return ids.size;
}
