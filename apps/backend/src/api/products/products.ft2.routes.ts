// apps/backend/src/api/products/products.ft2.routes.ts
import { Router } from 'express';
import { getProductsFt2 } from './products.ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * FT2 Products (read-only)
 */
router.get('/ft2', authenticateToken, requireFt2, getProductsFt2);

export default router;