// apps/backend/src/api/system/system.routes.ts

import { Router } from 'express';
import { httpGetSystemHealth } from './system.health.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

/**
 * @route   GET /api/v1/system/health
 * @desc    Returns projection cursor lag, snapshot age, and overall system status.
 * @access  Private — requires valid JWT
 *
 * Consumed by:
 * - UI degraded state banner (H-01)
 * - Support staff health checks
 * - Engineering deployment monitoring
 */
router.get('/health', authenticateToken, httpGetSystemHealth);

export default router;