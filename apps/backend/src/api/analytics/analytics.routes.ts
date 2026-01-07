// apps/backend/src/api/analytics/analytics.routes.ts

import { Router } from 'express';
import { analyticsFt2Controller } from './analytics.ft2.controller';

const router = Router();

router.get('/ft2', analyticsFt2Controller);

export default router;
