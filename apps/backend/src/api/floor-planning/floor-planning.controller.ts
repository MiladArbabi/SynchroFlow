// apps/backend/src/api/floor-planning/floor-planning.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * FLOOR PLANNING CONTROLLERS
 * ---------------------------
 * All queries are tenant-scoped via req.user.shopId + RLS current_tenant.
 *
 * warehouse_locations table exists (migration 0048).
 * variants table used for product barcode lookup.
 *
 * FEAT-002: Add barcode column to warehouse_locations migration.
 * FEAT-002: Join products table for product_title on variants query.
 */

export async function httpGetLayout(req: Request, res: Response) {
  const shopId = req.user?.shopId;

  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const zones = await trx('warehouse_locations')
        .where({ shop_id: shopId })
        .orderBy('location_code', 'asc')
        .select(
          'location_code',
          'type',
          'parent_location_code',
          'active',
          trx.raw(`0 as children_count`),
            /* Location barcodes stored on warehouse_locations.barcode (migration 0048). */
          'barcode'
        );

      const productBarcodes = await trx('variants as v')
        .leftJoin('external_product_identity_map as ep', function () {
          this.on('ep.lasyncro_variant_id', 'v.lasyncro_variant_id')
              .andOn('ep.shop_id', trx.raw('?', [shopId]));
        })
        .where('v.shop_id', shopId)
        .orderBy('v.created_at', 'desc')
        .select(
          'v.lasyncro_variant_id',
          'v.sku',
          trx.raw(`'' as product_title`),  // FEAT-002: join products table for title
          trx.raw(`null as variant_title`),
          'ep.barcode'
        );

      return { zones, product_barcodes: productBarcodes };
    });

    return res.json(result);
  } catch (err) {
    console.error('[floor-planning] httpGetLayout failed', err);
    return res.status(500).json({ error: 'Failed to fetch floor planning layout' });
  }
}

// ISSUE-003 fix: Allows owner/admin to correct a wrong or missing barcode on a variant.
// Updates external_product_identity_map — the authoritative physical scan resolution table.
// Safe: keyed on (shop_id, lasyncro_variant_id) — one row per variant per shop.
export async function httpUpdateProductBarcode(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const lasyncroVariantId = req.params.lasyncroVariantId as string;
  const { barcode } = req.body;

  if (!barcode || typeof barcode !== 'string' || barcode.trim() === '') {
    return res.status(400).json({ error: 'barcode is required and must be a non-empty string' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const updated = await trx('external_product_identity_map')
        .where({ lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
        .update({ barcode: barcode.trim() });

      if (updated === 0) {
        throw new Error('Variant not found in identity map');
      }
    });

    console.info('[floor-planning] barcode updated', { shopId, lasyncroVariantId, barcode });
    return res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Variant not found in identity map') {
      return res.status(404).json({ error: err.message });
    }
    console.error('[floor-planning] httpUpdateProductBarcode failed', err);
    return res.status(500).json({ error: 'Failed to update barcode' });
  }
}