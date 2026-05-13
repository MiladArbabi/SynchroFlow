// apps/backend/src/api/products/products.wms-readiness.controller.ts
//
// GET /api/v1/modules/products/wms-readiness
// ------------------------------------------
// Returns warehouse operability signals for the Products module.
// Visible to all tiers — WMS-Lite pickability is a core feature.
//
// HARD CONTRACT:
// - Authenticated + shop-scoped
// - Read-only — never mutates
// - Graceful null returns — no data = null fields, never 500

import { Request, Response } from 'express';
import { getProductsWmsReadinessFacts } from '../../services/products-operator/ProductsWmsReadinessFacts.service.js';

export async function getProductsWmsReadinessHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const facts = await getProductsWmsReadinessFacts(shopId);
    res.status(200).json(facts);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PRODUCTS_WMS_READINESS_FAILED]', { error: message });
    res.status(500).json({ error: message });
  }
}