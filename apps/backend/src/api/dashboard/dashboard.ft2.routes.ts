import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import { getDashboardFt2Snapshot } from './dashboard.ft2.controller';

const router = Router();

/**
 * FT2 Dashboard Snapshot
 * ----------------------
 * Read-only, system-level observability snapshot.
 * Backend-governed. Nullable by design.
 */
router.get('/ft2', authenticateToken, getDashboardFt2Snapshot);

export default router;