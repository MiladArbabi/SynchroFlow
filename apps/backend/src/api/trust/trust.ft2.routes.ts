// apps/backend/src/api/trust/trust.ft2.routes.ts
import { Router } from 'express';
import { getTrustFt2 } from './trust.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

const router = Router();

/**
 * FT2 Trust (read-only)
 */
router.get('/ft2', authenticateToken, requireFt2, getTrustFt2);

export default router;