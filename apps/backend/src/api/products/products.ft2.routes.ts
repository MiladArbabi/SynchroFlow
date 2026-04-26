// apps/backend/src/api/products/products.ft2.routes.ts
import { Router } from 'express';
import { getProductsFt2 } from './products.ft2.controller.js';
import { getProductsOperatorSummaryHandler } from './products.operator.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { httpPatchVariantCost, httpGetVariantCosts, httpBulkUpdateVariantCosts } from './products.cost.controller.js';

const router = Router();

/**
 * FT2 system observability snapshot.
 * Final path: GET /api/v1/modules/products/ft2
 */
router.get('/ft2', authenticateToken, requireFt2, getProductsFt2);

/**
 * Operator summary — purpose-built actionable surface.
 * No FTEP constraints. Direct operator facts.
 * Final path: GET /api/v1/modules/products/operator-summary
 */
router.get('/operator-summary', authenticateToken, getProductsOperatorSummaryHandler);

/**
 * Variant cost entry — updates unit_cost and backfills unfulfilled order revenue units.
 * Resolves missing_cogs alert when all variants for a shop have cost data.
 * Final path: PATCH /api/v1/modules/products/variants/:variantId/cost
 */
router.patch(
  '/variants/:variantId/cost',
  authenticateToken,
  requireFt2,
  httpPatchVariantCost
);

/**
 * Variant cost list — returns all variants with unit_cost for COGS entry UI.
 * Missing cost variants sorted first.
 * Final path: GET /api/v1/modules/products/variants/costs
 */
router.get(
  '/variants/costs',
  authenticateToken,
  requireFt2,
  httpGetVariantCosts
);

/**
 * Bulk variant cost upload — accepts parsed CSV rows, updates unit_cost + backfills revenue units.
 * Final path: POST /api/v1/modules/products/variants/costs/bulk
 */
router.post(
  '/variants/costs/bulk',
  authenticateToken,
  requireFt2,
  httpBulkUpdateVariantCosts
);

export default router;