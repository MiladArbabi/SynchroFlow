// apps/backend/src/api/products/products.routes.ts
import { Router } from 'express';
import { fetchProducts } from './products.controller.js';
import { getProductsFt2 } from './products.ft2.controller.js';
import { getProductsOperatorSummaryHandler } from './products.operator.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

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
 */
router.get('/operator-summary', authenticateToken, getProductsOperatorSummaryHandler);

router.get('/', authenticateToken, fetchProducts);

export default router;