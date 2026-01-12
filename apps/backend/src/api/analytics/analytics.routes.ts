// apps/backend/src/api/analytics/analytics.routes.ts
import { Router } from 'express';
import { analyticsFt2Controller } from './analytics.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { requireFt2 } from 'api-src/middleware/require-ft2.middleware';

const router = Router();

router.get('/ft2', authenticateToken, requireFt2, analyticsFt2Controller);

export default router;