// apps/backend/src/services/wms/barcodeResolution.service.ts
import { Knex } from 'knex';
import { resolveUnitBarcode } from './inventoryUnit.service.js';

/**
 * BARCODE RESOLUTION SERVICE (WM-02, WM-46)
 * -------------------------------------------
 * Resolves a scanned barcode to a variant (and optionally a unit record).
 *
 * Namespace routing (WM-46, GH-1085):
 *   LSU-{8char} → unit barcode path — inventory_units lookup (exact unit)
 *   LSO-{8char} → invoice barcode — reject here (handled by httpScanResolve)
 *   LSP-{8char} → laSyncro product identity — variants.lasyncro_barcode
 *   anything else → legacy EAN/UPC/SKU path, gated by legacy_barcode_fallback_enabled
 *
 * LSP- is resolved BEFORE the legacy gate is read, and never falls through to
 * it. These are laSyncro's own printed labels, so a tenant that has sunset
 * legacy EAN/UPC/SKU scanning must still be able to scan them — otherwise the
 * app's barcodes stop working precisely for the tenants furthest along the
 * unit-labelling migration. And because LSP- is a reserved namespace, an
 * unknown one is a miss, never a value to reinterpret as somebody's SKU.
 *
 * Legacy resolution priority (when fallback enabled):
 *   1. barcode          — direct physical scan match
 *   2. external_sku     — fallback for variants without barcode
 *   3. external_variant_id — last resort platform ID match
 *
 * All lookups are tenant-scoped via shop_id.
 * Caller must have SET LOCAL "app.current_tenant" active.
 *
 * Returns null if no match found — caller decides exception handling.
 */

export interface BarcodeResolutionResult {
  lasyncro_variant_id: string;
  resolution_method: 'unit_barcode' | 'product_barcode' | 'barcode' | 'sku' | 'external_variant_id';
  lasyncro_unit_id?: string;
  unit_status?: string;
  current_location_code?: string | null;
}

export async function resolveBarcode(
  trx: Knex | Knex.Transaction,
  shopId: number,
  scannedValue: string
): Promise<BarcodeResolutionResult | null> {

  // ── 1. LSU- unit barcode (WM-46) ────────────────────────────────────────
  if (scannedValue.startsWith('LSU-')) {
    const unit = await resolveUnitBarcode(trx as Knex.Transaction, shopId, scannedValue);
    if (!unit) {
      console.warn('[BARCODE_RESOLUTION] LSU- not found', { shopId, scannedValue });
      return null;
    }
    console.info('[BARCODE_RESOLUTION]', {
      method: 'unit_barcode',
      shopId,
      scannedValue,
      lasyncro_variant_id: unit.lasyncro_variant_id,
    });
    return {
      lasyncro_variant_id: unit.lasyncro_variant_id,
      resolution_method: 'unit_barcode',
      lasyncro_unit_id: unit.lasyncro_unit_id,
      unit_status: unit.status,
      current_location_code: unit.current_location_code,
    };
  }

  // ── 2. LSO- invoice barcode — not a variant scan, reject early ──────────
  if (scannedValue.startsWith('LSO-')) {
    console.warn('[BARCODE_RESOLUTION] LSO- invoice barcode received at variant resolver', { shopId, scannedValue });
    return null;
  }

  // ── Generic-product unit lookup — shared by every non-exact namespace ─────
  // After resolving to a VARIANT (rather than to one specific unit), attach the
  // next available inventory unit so stow/pick confirm endpoints have something
  // to thread through. Priority: received (stow path) → stowed (pick path),
  // then receive_sequence ascending. Eligibility and ordering are unchanged
  // from the previous pickLegacyUnit; only the name and position moved, so the
  // LSP- branch below can share it. LSU- does NOT use this — it already
  // resolved an exact unit and must keep its exact-unit semantics.
  // Returns null if no unit available — caller handles gracefully.
  const resolveAvailableUnitForVariant = async (variantId: string) => {
    const unit = await trx('inventory_units')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId })
      .whereIn('status', ['received', 'stowed'])
      .orderByRaw(`CASE status WHEN 'received' THEN 0 WHEN 'stowed' THEN 1 END`)
      .orderBy('receive_sequence', 'asc')
      .select('lasyncro_unit_id', 'status', 'current_location_code')
      .first();
    return unit ?? null;
  };

  // ── 3. LSP- laSyncro product barcode (GH-1085) ──────────────────────────
  //
  // Deliberately ahead of the legacy gate: this is our own label, not a
  // platform identifier, so legacy_barcode_fallback_enabled has no bearing on
  // it. Tenant-scoped like every other lookup — one shop's product identity
  // must never resolve inside another shop.
  //
  // A miss returns null rather than falling through. LSP- is reserved, so a
  // foreign or unknown value must never be reinterpreted as an external SKU or
  // external_variant_id.
  if (scannedValue.startsWith('LSP-')) {
    const variant = await trx('variants')
      .where({ shop_id: shopId, lasyncro_barcode: scannedValue })
      .select('lasyncro_variant_id')
      .first();

    if (!variant?.lasyncro_variant_id) {
      console.warn('[BARCODE_RESOLUTION] LSP- not found in this shop', { shopId, scannedValue });
      return null;
    }

    const unit = await resolveAvailableUnitForVariant(variant.lasyncro_variant_id);
    console.info('[BARCODE_RESOLUTION]', {
      method: 'product_barcode',
      shopId,
      scannedValue,
      lasyncro_variant_id: variant.lasyncro_variant_id,
      lasyncro_unit_id: unit?.lasyncro_unit_id ?? null,
    });
    return {
      lasyncro_variant_id:   variant.lasyncro_variant_id,
      resolution_method:     'product_barcode',
      lasyncro_unit_id:      unit?.lasyncro_unit_id      ?? undefined,
      unit_status:           unit?.status                ?? undefined,
      current_location_code: unit?.current_location_code ?? undefined,
    };
  }

  // ── 4. Legacy EAN/UPC/SKU — gated by legacy_barcode_fallback_enabled ───
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select('legacy_barcode_fallback_enabled')
    .first();

  if (settings && settings.legacy_barcode_fallback_enabled === false) {
    console.warn('[BARCODE_RESOLUTION] legacy barcode rejected — fallback disabled', { shopId, scannedValue });
    return null;
  }

  // 4a. Barcode — primary physical scan resolution.
  //
  // SHOP-REV-01c: this previously read external_product_identity_map alone.
  // That table's barcode column (migration 0004) is populated only via the
  // onConflict.merge() path in shopifyProducts.core.ts and on this tenant
  // carried 3 rows, all SKU strings — while all 14 real Shopify barcodes sat
  // in variants.barcode. The two sets were disjoint, so every physical scan
  // of a real product barcode missed here, fell through to the SKU and
  // external_variant_id paths, and returned null. Shopify paused App Store
  // review on 2026-07-29 (ref 102766) citing exactly this.
  //
// Both columns hold the same thing: the EXTERNAL EAN/UPC from Shopify.
  // Neither is the LaSyncro-minted product identity — that lives in
  // variants.lasyncro_barcode as the reserved LSP-* namespace and is resolved
  // above before the legacy fallback gate.
  //
  // variants.barcode is the designated receive-time lookup target: migration
  // 0027 carries a dedicated ['shop_id','barcode'] index annotated "fast EAN
  // lookup at receive scan time", and its own doc comment defines the receive
  // branch on whether this column is null. The identity map's barcode column
  // (migration 0004) is only ever written by the onConflict.merge() path in
  // shopifyProducts.core.ts, which on this tenant left it holding 3 SKU
  // strings against 14 real barcodes in variants.
  //
  // Identity map is queried first purely to preserve existing behaviour for
  // tenants where it is populated; variants.barcode is the fallback that makes
  // a physical scan work. Both lookups are shop-scoped. Why the two columns
  // diverge at all is a separate defect in the product sync (SHOP-REV-01e).
  const byBarcode =
    (await trx('external_product_identity_map')
      .where({ shop_id: shopId, barcode: scannedValue })
      .select('lasyncro_variant_id')
      .first()) ??
    (await trx('variants')
      .where({ shop_id: shopId, barcode: scannedValue })
      .select('lasyncro_variant_id')
      .first());

  // 4a. Barcode — primary physical scan resolution
  if (byBarcode?.lasyncro_variant_id) {
    const unit = await resolveAvailableUnitForVariant(byBarcode.lasyncro_variant_id);
    console.info('[BARCODE_RESOLUTION]', {
      method: 'barcode',
      shopId,
      scannedValue,
      lasyncro_variant_id: byBarcode.lasyncro_variant_id,
      lasyncro_unit_id: unit?.lasyncro_unit_id ?? null,
    });
    return {
      lasyncro_variant_id:   byBarcode.lasyncro_variant_id,
      resolution_method:     'barcode',
      lasyncro_unit_id:      unit?.lasyncro_unit_id      ?? undefined,
      unit_status:           unit?.status                ?? undefined,
      current_location_code: unit?.current_location_code ?? undefined,
    };
  }

  // 4b. SKU — fallback
  const bySku = await trx('external_product_identity_map')
    .where({ shop_id: shopId, external_sku: scannedValue })
    .select('lasyncro_variant_id')
    .first();

  if (bySku?.lasyncro_variant_id) {
    const unit = await resolveAvailableUnitForVariant(bySku.lasyncro_variant_id);
    console.info('[BARCODE_RESOLUTION]', {
      method: 'sku',
      shopId,
      scannedValue,
      lasyncro_variant_id: bySku.lasyncro_variant_id,
      lasyncro_unit_id: unit?.lasyncro_unit_id ?? null,
    });
    return {
      lasyncro_variant_id:   bySku.lasyncro_variant_id,
      resolution_method:     'sku',
      lasyncro_unit_id:      unit?.lasyncro_unit_id      ?? undefined,
      unit_status:           unit?.status                ?? undefined,
      current_location_code: unit?.current_location_code ?? undefined,
    };
  }

  // 4c. External variant ID — last resort
  const byVariantId = await trx('external_product_identity_map')
    .where({ shop_id: shopId, external_variant_id: scannedValue })
    .select('lasyncro_variant_id')
    .first();

  if (byVariantId?.lasyncro_variant_id) {
    const unit = await resolveAvailableUnitForVariant(byVariantId.lasyncro_variant_id);
    console.info('[BARCODE_RESOLUTION]', {
      method: 'external_variant_id',
      shopId,
      scannedValue,
      lasyncro_variant_id: byVariantId.lasyncro_variant_id,
      lasyncro_unit_id: unit?.lasyncro_unit_id ?? null,
    });
    return {
      lasyncro_variant_id:   byVariantId.lasyncro_variant_id,
      resolution_method:     'external_variant_id',
      lasyncro_unit_id:      unit?.lasyncro_unit_id      ?? undefined,
      unit_status:           unit?.status                ?? undefined,
      current_location_code: unit?.current_location_code ?? undefined,
    };
  }

  // No match found
  console.warn('[BARCODE_RESOLUTION_FAILED]', { shopId, scannedValue });
  return null;
}