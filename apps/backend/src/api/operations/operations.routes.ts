// apps/backend/src/api/operations/operations.routes.ts
//
// OPS-CONSOLE-WAITING-01 — canonical shop-wide WAITING route.

import { Router } from 'express';
import { httpGetHistory, httpGetOperationalEpisodes, httpGetWaiting } from './operations.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/v1/operations/waiting
 * Auth matches the sibling GET /api/v1/decisions route's own precedent
 * (authenticateToken only) — same read-only, tenant-scoped shape.
 */
router.get('/waiting', authenticateToken, httpGetWaiting);

/**
 * GET /api/v1/operations/history
 * OPS-CONSOLE-HISTORY-01 — canonical shop-wide HISTORY V1 route. Same auth
 * shape as the sibling WAITING route above.
 */
router.get('/history', authenticateToken, httpGetHistory);

/**
 * GET /api/v1/operations/episodes
 * SLICE D0 — canonical shop-wide operational-episode V1 route. Same auth
 * shape as the sibling WAITING/HISTORY routes above.
 */
router.get('/episodes', authenticateToken, httpGetOperationalEpisodes);

export default router;
