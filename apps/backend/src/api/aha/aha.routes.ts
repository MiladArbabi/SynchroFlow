// apps/backend/src/api/aha/aha.routes.ts
import { Router } from 'express';
import { getAhaSignal } from './aha.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/v1/aha/signal
 * ----------------------
 * Returns the highest-priority Aha signal for the authenticated shop.
 * Runs 6-signal priority cascade — first match wins.
 */
router.get('/signal', authenticateToken, getAhaSignal);

export default router;