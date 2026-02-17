// apps/backend/src/api/trust/trust.ft2.routes.ts
import { Router } from 'express';
import { getTrustFt2 } from './trust.ft2.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

/**
 * FT2 Trust (read-only)
 */
router.get('/ft2', authenticateToken, requireFt2, getTrustFt2);

export default router;