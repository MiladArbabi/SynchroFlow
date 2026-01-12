// apps/backend/src/api/products/products.ft2.routes.ts
import { Router } from 'express';
import { getProductsFt2 } from './products.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

const router = Router();

/**
 * FT2 Products (read-only)
 */
router.get('/ft2', authenticateToken, requireFt2, getProductsFt2);

export default router;