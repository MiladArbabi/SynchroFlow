// apps/backend/src/services/wms/barcodeResolution.service.ts
import { Knex } from 'knex';

/**
 * BARCODE RESOLUTION SERVICE (WM-02)
 * ------------------------------------
 * Resolves a scanned barcode or SKU to a lasyncro_variant_id.
 *
 * Resolution priority (in order):
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
  resolution_method: 'barcode' | 'sku' | 'external_variant_id';
}

export async function resolveBarcode(
  trx: Knex | Knex.Transaction,
  shopId: number,
  scannedValue: string
): Promise<BarcodeResolutionResult | null> {

  // 1. Barcode — primary physical scan resolution
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
  console.warn('[BARCODE_RESOLUTION_FAILED]', {
    shopId,
    scannedValue,
  });

  return null;
}