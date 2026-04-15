import { Router } from 'express';
import { getOverviewFt2 } from './overview.ft2.controller.js';
import { getOverviewModulesFt2 } from './overview.modules-ft2.controller.js';
import { getMorningBrief } from './overview.morning-brief.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
const router = Router();
/**
 * STRICT Overview FT2
 * ------------------
 * Trust + completion gated
 */
router.get(
  '/ft2',
  authenticateToken,
  requireFt2,
  getOverviewFt2
);
/**
 * Overview Modules FT2
 * -------------------
 * Independent module visibility
 * NOT trust-gated
 * NOT completion-gated
 */
router.get(
  '/modules-ft2',
  authenticateToken,
  getOverviewModulesFt2
);
/**
 * Morning Brief (OVR-01)
 * ----------------------
 * Owner/admin only — operators have no brief, only WMS job queue.
 * Trust gated in resolver — returns 204 if trust not eligible.
 * Cache-first — recomputes if expired or ?force=true.
 */
router.get(
  '/morning-brief',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  getMorningBrief
);
export default router;