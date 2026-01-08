// apps/backend/src/api/products/products.ft2.routes.ts
import { Router } from 'express';
import { getProductsFt2 } from './products.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';

const router = Router();

/**
 * FT2 Products (read-only)
 */
router.get('/ft2', authenticateToken, getProductsFt2);

export default router;