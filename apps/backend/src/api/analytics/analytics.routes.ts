// apps/backend/src/api/analytics/analytics.routes.ts
import { Router } from 'express';
import { analyticsFt2Controller } from './analytics.ft2.controller';
import { authenticateToken } from 'api-src/middleware/auth.middleware';

const router = Router();

router.get('/ft2', authenticateToken, analyticsFt2Controller);

export default router;