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

    const rows = await withTenant(shopId, (trx) => trx('variants as v')
      .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
      .leftJoin('inventory_truth as it', 'it.lasyncro_variant_id', 'v.lasyncro_variant_id')
      .where('v.shop_id', shopId)
      // INV-006: canonical inventory universe = physical only.
      // digital/service/gift_card carry no warehouse stock and distort sellability + cost counts.
      .where('p.product_type', 'physical')
      .select([
        'v.lasyncro_variant_id',
        'v.sku',
        'v.title as variant_title',
        'v.image_url',
        'v.status',
        'p.title as product_title',
        'p.lasyncro_product_id',
        'p.product_type',
        db.raw('COALESCE(it.on_hand_quantity, 0) as on_hand_quantity'),
        db.raw('COALESCE(it.available_quantity, 0) as available_quantity'),
        db.raw('COALESCE(it.sellable_quantity, 0) as sellable_quantity'),
        db.raw('(it.lasyncro_variant_id IS NOT NULL) as has_inventory_record'),
      ])
      .orderBy(['p.title', 'v.title'])
    );

    res.status(200).json({ variants: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}