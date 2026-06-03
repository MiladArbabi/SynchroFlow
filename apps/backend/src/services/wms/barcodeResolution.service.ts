// apps/backend/src/services/wms/barcodeResolution.service.ts
import { Knex } from 'knex';
import { resolveUnitBarcode } from './inventoryUnit.service.js';

/**
 * BARCODE RESOLUTION SERVICE (WM-02, WM-46)
 * -------------------------------------------
 * Resolves a scanned barcode to a variant (and optionally a unit record).
 *
 * Namespace routing (WM-46):
 *   LSU-{8char} → unit barcode path — inventory_units lookup
 *   LSO-{8char} → invoice barcode — reject here (handled by httpScanResolve)
 *   anything else → legacy EAN/UPC/SKU path, gated by legacy_barcode_fallback_enabled
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
  resolution_method: 'unit_barcode' | 'barcode' | 'sku' | 'external_variant_id';
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

  // ── 3. Legacy EAN/UPC/SKU — gated by legacy_barcode_fallback_enabled ───
  const settings = await trx('shop_wms_settings')
    .where({ shop_id: shopId })
    .select('legacy_barcode_fallback_enabled')
    .first();

  if (settings && settings.legacy_barcode_fallback_enabled === false) {
    console.warn('[BARCODE_RESOLUTION] legacy barcode rejected — fallback disabled', { shopId, scannedValue });
    return null;
  }

  // 3a. Barcode — primary physical scan resolution
  const byBarcode = await trx('external_product_identity_map')
    .where({ shop_id: shopId, barcode: scannedValue })
    .select('lasyncro_variant_id')
    .first();

  if (byBarcode?.lasyncro_variant_id) {
    console.info('[BARCODE_RESOLUTION]', {
      method: 'barcode',
      shopId,
      scannedValue,
      lasyncro_variant_id: byBarcode.lasyncro_variant_id,
    });
    return {
      lasyncro_variant_id: byBarcode.lasyncro_variant_id,
      resolution_method: 'barcode',
    };
  }

  // 2. SKU — fallback
  const bySku = await trx('external_product_identity_map')
    .where({ shop_id: shopId, external_sku: scannedValue })
    .select('lasyncro_variant_id')
    .first();

  if (bySku?.lasyncro_variant_id) {
    console.info('[BARCODE_RESOLUTION]', {
      method: 'sku',
      shopId,
      scannedValue,
      lasyncro_variant_id: bySku.lasyncro_variant_id,
    });
    return {
      lasyncro_variant_id: bySku.lasyncro_variant_id,
      resolution_method: 'sku',
    };
  }

  // 3. External variant ID — last resort
  const byVariantId = await trx('external_product_identity_map')
    .where({ shop_id: shopId, external_variant_id: scannedValue })
    .select('lasyncro_variant_id')
    .first();

  if (byVariantId?.lasyncro_variant_id) {
    console.info('[BARCODE_RESOLUTION]', {
      method: 'external_variant_id',
      shopId,
      scannedValue,
      lasyncro_variant_id: byVariantId.lasyncro_variant_id,
    });
    return {
      lasyncro_variant_id: byVariantId.lasyncro_variant_id,
      resolution_method: 'external_variant_id',
    };
  }

  // No match found
  console.warn('[BARCODE_RESOLUTION_FAILED]', { shopId, scannedValue });
  return null;
}