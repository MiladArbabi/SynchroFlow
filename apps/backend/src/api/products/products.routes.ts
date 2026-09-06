// apps/backend/src/api/products/products.routes.ts
import { Router } from 'express';
import { fetchProducts } from './products.controller.js';
import { getProductsFt2 } from './products.ft2.controller.js';
import { getProductsOperatorSummaryHandler } from './products.operator.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireCapability } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

/**
 * FT2 snapshot — system observability surface.
 * Final path: GET /api/v1/modules/products/ft2
 *
 * P0-A3-4: this LEGACY alias is still mounted at /api/v1/products, so it must
 * resolve the SAME commercial policy as the canonical mount — otherwise a
 * caller could simply pick the cheaper door.
 */
router.get('/ft2', authenticateToken, requireFt2, requireCapability('inventory.core'), getProductsFt2);

/**
 * Operator summary — purpose-built actionable surface.
 * No FTEP constraints. Direct operator facts.
 * Final path: GET /api/v1/modules/products/operator-summary
 *
 * SECURITY FIX (audit ISS-P-PRODUCTS-01): route had zero tier
 * enforcement — Starter shops could pull real margin/warehouse
 * intelligence data. A tier gate was added; FTEP exemption
 * (requireFt2) intentionally left untouched per original design note.
 *
 * P0-A3-4: that enforcement previously lived as a hand-rolled tier check INSIDE
 * products.operator.controller.ts. It now lives here, as the canonical
 * `inventory.core` capability, so the denial comes from the shared middleware
 * and carries the canonical COMMERCIAL_ACCESS_DENIED contract.
 */
router.get(
  '/operator-summary',
  authenticateToken,
  requireCapability('inventory.core'),
  getProductsOperatorSummaryHandler
);

/**
 * SECURITY FIX (audit ISS-P-PRODUCTS-01): product list had zero tier
 * enforcement.
 *
 * P0-A3-4: migrated from a raw tier gate to the canonical `inventory.core`
 * capability (module `products` + Core+).
 */
router.get('/', authenticateToken, requireCapability('inventory.core'), fetchProducts);

export default router;
