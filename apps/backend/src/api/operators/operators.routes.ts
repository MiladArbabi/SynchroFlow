// apps/backend/src/api/operators/operators.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import {
  httpGetMyAvailability,
  httpUpsertAvailability,
  httpGetTeamAvailability,
  httpGetTeamOperators,
} from './operators.controller.js';

const router = Router();

/**
 * Operator self-declares availability for calendar week.
 * GET  /api/v1/operators/availability?week=YYYY-MM-DD
 * POST /api/v1/operators/availability
 */
router.get('/availability', authenticateToken, httpGetMyAvailability);
router.post('/availability', authenticateToken, httpUpsertAvailability);

/**
 * Owner/admin reads full team availability.
 * GET /api/v1/operators/team-availability?week=YYYY-MM-DD
 */
router.get('/team-availability', authenticateToken, httpGetTeamAvailability);

/**
 * Owner/admin fetches list of all shop operators for task assignment.
 * GET /api/v1/operators/team
 */
router.get('/team', authenticateToken, httpGetTeamOperators);

export default router;