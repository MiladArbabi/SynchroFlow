// apps/backend/src/api/demand/demand.routes.ts

import { Router } from 'express';
import { httpGetDemand } from './demand.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';

const router = Router();

router.get('/', authenticateToken, requireFt2, httpGetDemand);

export default router;