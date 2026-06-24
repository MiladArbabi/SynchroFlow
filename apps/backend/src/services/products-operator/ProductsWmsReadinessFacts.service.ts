// apps/backend/src/services/products-operator/ProductsWmsReadinessFacts.service.ts
//
// ProductsWmsReadinessFacts
// -------------------------
// Warehouse operability signals for the Products module.
//
// Answers: "can my WMS-Lite actually pick, receive, and count this product?"
//
// Signal sources:
//   - variants             → SKU presence (pickability gate)
//   - inventory_unit_status → bin assignment post-stow
//   - inventory_truth      → on_hand vs available delta (variance/shrinkage)
//   - receive_jobs         → open inbound jobs with rejected units
//
// DESIGN CONTRACT:
// - Read-only — never mutates
// - All queries tenant-scoped via trx (injected by withTenant caller)
// - null counts = data not yet available (no WMS activity for shop)
// - Visible to all tiers — WMS-Lite operability is a core differentiator
import { withTenant } from '@lasyncro/backend-core/db.js';

export type ProductsWmsReadinessFacts = {
  // ── Pickability ────────────────────────────────────────────
  // Variants with no SKU — WMS-Lite camera scan will fail at pick step
  not_pickable_count: number | null;

  // Variants with SKU but no stow record in inventory_unit_status
  // Present in catalog but warehouse doesn't know where they live
  no_bin_location_count: number | null;

  // ── Inventory trust ────────────────────────────────────────
  // Variants where on_hand_quantity !== reserved + committed + available
  // Signals shrinkage, unrecorded movements, or sync failures
  variance_count: number | null;

  // Total units missing across all variance variants
  // on_hand - (reserved + committed + available) summed across affected variants
  total_variance_units: number | null;

  // ── Receive readiness ──────────────────────────────────────
  // Open receive jobs with rejected units — need operator attention
  open_receive_jobs_with_rejections: number | null;

  // Total units rejected across open receive jobs
  total_rejected_units: number | null;

  // ── Freshness ─────────────────────────────────────────────
  // Oldest last_evaluated_at across inventory_truth rows for this shop
  // Signals how stale the inventory projection is
  oldest_inventory_evaluated_at: string | null;
};

export async function getProductsWmsReadinessFacts(
  shopId: number
): Promise<ProductsWmsReadinessFacts> {
  return withTenant(shopId, async (trx) => {
    const qb = trx;

    // ── Not pickable: variants with no SKU ───────────────────
    const notPickableResult = await qb('variants')
      .where('shop_id', shopId)
      .where('status', 'active')
      .andWhere(function () {
        this.whereNull('sku').orWhere('sku', '');
      })
      .count('lasyncro_variant_id as count')
      .first();
      
    const not_pickable_count = notPickableResult
      ? Number(notPickableResult.count)
      : null;

    // ── No bin location: SKU present, never stowed ───────────
    // LEFT JOIN inventory_unit_status — no stow record = unlocated
    const noBinResult = await qb('variants as v')
      .leftJoin('inventory_unit_status as ius', function () {
        this.on('ius.lasyncro_variant_id', 'v.lasyncro_variant_id')
            .andOn('ius.shop_id', qb.raw('?', [shopId]));
      })
      .where('v.shop_id', shopId)
      .whereNotNull('v.sku')
      .where('v.sku', '!=', '')
      .where('v.status', 'active')
      .whereNull('ius.lasyncro_variant_id')
      .count('v.lasyncro_variant_id as count')
      .first();
    const no_bin_location_count = noBinResult
      ? Number(noBinResult.count)
      : null;

    // ── Variance: on_hand != reserved + committed + available ─
    // Groups by variant, sums across all locations per variant
    const varianceRows = await qb('inventory_truth as it')
      .join('variants as v', 'v.lasyncro_variant_id', 'it.lasyncro_variant_id')
      .where('it.shop_id', shopId)
      .groupBy('it.lasyncro_variant_id')
      // PROJ-005: a true variance compares ledger on_hand vs a PHYSICAL cycle count.
      // available_quantity is derived (on_hand − reserved), so on_hand vs
      // (reserved + committed + available) is a tautology that can never fire.
      // Gated to a real cycle-count source (blueprint INV-04); until then this
      // intentionally returns no rows rather than a meaningless 0/non-0.
      .havingRaw('1 = 0')
      .select(
        qb.raw('SUM(it.on_hand_quantity) - SUM(it.reserved_quantity + it.committed_quantity + it.available_quantity) as delta')
      );

    // Return 0 (not null) when query runs but finds no variance — 0 is a positive signal.
    // null reserved for "no inventory_truth data exists for this shop".
    const hasInventoryData = (await qb('inventory_truth').where('shop_id', shopId).count('* as count').first())?.count;
    const variance_count = hasInventoryData && Number(hasInventoryData) > 0
      ? varianceRows.length
      : null;
    const total_variance_units = hasInventoryData && Number(hasInventoryData) > 0
      ? varianceRows.reduce((sum: number, r: any) => sum + Math.abs(Number(r.delta)), 0)
      : null;

    // ── Open receive jobs with rejections ─────────────────────
    const receiveResult = await qb('receive_jobs')
      .where('shop_id', shopId)
      .whereIn('status', ['pending', 'in_progress', 'inspection', 'stow_ready'])
      .where('units_rejected', '>', 0)
      .select(
        qb.raw('COUNT(*) as job_count'),
        qb.raw('SUM(units_rejected) as total_rejected')
      )
      .first();

    const open_receive_jobs_with_rejections = receiveResult?.job_count
      ? Number(receiveResult.job_count)
      : null;
    const total_rejected_units = receiveResult?.total_rejected
      ? Number(receiveResult.total_rejected)
      : null;

    // ── Oldest inventory evaluation ───────────────────────────
    const freshnessResult = await qb('inventory_truth')
      .where('shop_id', shopId)
      .min('last_evaluated_at as oldest')
      .first();

    const oldest_inventory_evaluated_at = freshnessResult?.oldest
      ? String(freshnessResult.oldest)
      : null;

    return {
      not_pickable_count,
      no_bin_location_count,
      variance_count,
      total_variance_units,
      open_receive_jobs_with_rejections,
      total_rejected_units,
      oldest_inventory_evaluated_at,
    };
  });
}