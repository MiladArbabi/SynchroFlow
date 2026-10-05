// apps/backend/src/api/products/products.catalog.controller.ts
//
// GET /api/v1/modules/products/catalog
// -------------------------------------
// Returns per-variant catalog list with image_url, product title,
// variant title, sku, status, and sellable_quantity.
// Used by ProductsCatalogPage to render the product image list.

import { Request, Response } from 'express';
import db, { withTenant } from '@lasyncro/backend-core/db.js';

export async function getProductsCatalogHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) { res.status(401).json({ error: 'Unauthorized' }); return;}

    const rows = await withTenant(shopId, (trx) => {
      // inventory_truth is location-granular. Aggregate before joining so the
      // Items boundary has exactly one row per variant, including absent truth.
      const truth = trx('inventory_truth')
        .where('shop_id', shopId)
        .groupBy('lasyncro_variant_id')
        .select('lasyncro_variant_id')
        .sum({ on_hand_quantity: 'on_hand_quantity', available_quantity: 'available_quantity',
          reserved_quantity: 'reserved_quantity', sellable_quantity: 'sellable_quantity' })
        .as('it');
      return trx('variants as v')
      .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
      .leftJoin(truth, 'it.lasyncro_variant_id', 'v.lasyncro_variant_id')
      .where('v.shop_id', shopId)
      .where('p.shop_id', shopId)
      // INV-006: canonical inventory universe = physical only.
      // digital/service/gift_card carry no warehouse stock and distort sellability + cost counts.
      .where('p.product_type', 'physical')
      .select([
        'v.lasyncro_variant_id',
        'v.sku',
        'v.barcode',
        'v.lasyncro_barcode',
        'v.unit_cost',
        db.raw("CASE WHEN v.unit_cost <= 0 THEN 'missing' ELSE 'present' END as cost_state"),
        db.raw("(NULLIF(BTRIM(v.lasyncro_barcode), '') IS NULL) as scan_identity_issue"),
        'v.title as variant_title',
        'v.image_url',
        'v.status',
        'p.title as product_title',
        'p.lasyncro_product_id',
        'p.product_type',
        'it.on_hand_quantity',
        'it.available_quantity',
        'it.reserved_quantity',
        'it.sellable_quantity',
        db.raw('(it.lasyncro_variant_id IS NOT NULL) as has_inventory_record'),
      ])
      .orderBy(['p.title', 'v.title']);
    });

    // PostgreSQL SUM(integer) is bigint and numeric costs arrive as strings.
    // The Items wire contract exposes numbers while retaining absent truth.
    res.status(200).json({ variants: rows.map(row => ({
      ...row,
      on_hand_quantity: row.on_hand_quantity == null ? null : Number(row.on_hand_quantity),
      available_quantity: row.available_quantity == null ? null : Number(row.available_quantity),
      reserved_quantity: row.reserved_quantity == null ? null : Number(row.reserved_quantity),
      sellable_quantity: row.sellable_quantity == null ? null : Number(row.sellable_quantity),
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
