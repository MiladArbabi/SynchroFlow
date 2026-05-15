// apps/backend/src/api/returns/returns.routes.ts
import { Router } from 'express';
import { httpGetReturns } from './returns.controller.js';
import { httpGetReturnsCorrelation } from './returns.correlation.controller.js';
import {
  httpListReturnJobs,
  httpCreateReturnJob,
  httpProcessReturnLine,
  httpCompleteReturnJob,
  httpListItemsAwaitingDecision,
  httpSetOwnerDecision,
} from './returnJobs.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';

const router = Router();

// ── Intelligence (existing) ───────────────────────────────────────────────────

router.get('/',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:read'),
  httpGetReturns
);

router.get('/correlation',
  authenticateToken, requireFt2, requireTier('growth'), requireAction('returns:read'),
  httpGetReturnsCorrelation
);

// ── Return Jobs — operator workflow (mobile + web) ────────────────────────────

router.get('/jobs',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:read'),
  httpListReturnJobs
);

router.post('/jobs',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:job:create'),
  httpCreateReturnJob
);

router.patch('/jobs/:id/lines/:lineId',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:job:process'),
  httpProcessReturnLine
);

router.post('/jobs/:id/complete',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:job:complete'),
  httpCompleteReturnJob
);

// ── Owner decision surface (web — ReturnsItemsPage) ───────────────────────────

router.get('/items',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:read'),
  httpListItemsAwaitingDecision
);

router.patch('/items/:id/decision',
  authenticateToken, requireFt2, requireTier('core'), requireAction('returns:decision:write'),
  httpSetOwnerDecision
);

export default router;