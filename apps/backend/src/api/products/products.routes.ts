// apps/backend/src/api/products/products.routes.ts
import { Router } from 'express';
import { fetchProducts } from './products.controller.js';
import { getProductsFt2 } from './products.ft2.controller.js';
import { getProductsOperatorSummaryHandler } from './products.operator.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

/**
 * FT2 snapshot — system observability surface.
 * Final path: GET /api/v1/modules/products/ft2
 */
router.get('/ft2', authenticateToken, requireFt2, getProductsFt2);

/**
 * Operator summary — purpose-built actionable surface.
 * No FTEP constraints. Direct operator facts.
 * Final path: GET /api/v1/modules/products/operator-summary
 *
 * SECURITY FIX (audit ISS-P-PRODUCTS-01): route had zero tier
 * enforcement — Starter shops could pull real margin/warehouse
 * intelligence data. requireTier('core') added; FTEP exemption
 * (requireFt2) intentionally left untouched per original design note.
 */
router.get('/operator-summary', authenticateToken, requireTier('core'), getProductsOperatorSummaryHandler);

/**
 * SECURITY FIX (audit ISS-P-PRODUCTS-01): product list had zero tier
 * enforcement. requireTier('core') added to match the 'products'
 * module's tier in packages/backend-core/src/config/tiers.ts.
 */
router.get('/', authenticateToken, requireTier('core'), fetchProducts);

export default router;