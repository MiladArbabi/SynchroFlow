// apps/backend/src/api/demand/demand.routes.ts
import { Router } from 'express';
import { httpGetDemand } from './demand.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireCapability } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// Demand is an intelligence module (MON-06).
// COMMERCIAL-ACCESS-ARCH-01 P0-A2A: gate via the canonical demand.forecasting
// capability (moduleId: demand, minimumTier: growth, feature: demand.forecasting)
// — runtime-identical to the prior Growth tier gate (Starter/Core deny,
// Growth/Scale allow).
router.get('/', authenticateToken, requireFt2, requireCapability('demand.forecasting'), httpGetDemand);

export default router;