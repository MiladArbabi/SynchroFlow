// apps/backend/src/api/alerts/alerts.routes.ts
import { Router } from 'express';
import {
  httpGetAlerts,
  httpDismissAlert,
  httpAcknowledgeAlert,
  httpSnoozeAlert,
  httpResolveAlert,
} from './alerts.controller.js';
import {
  httpGetAlertRules,
  httpCreateAlertRule,
  httpDeleteAlertRule,
} from './alertRules.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';

const router = Router();

/**
 * ALERTS ROUTES
 * -------------
 * All routes: authenticateToken → requireFt2 → requireAction
 * Audience filtering (operator sees warehouse_floor only) is enforced
 * in httpGetAlerts controller — not at route level.
 * Role checks for resolve are belt-and-suspenders:
 *   requireAction('alerts:resolve') at route + manual check in controller.
 */

router.get('/',
  authenticateToken,
  requireFt2,
  requireAction('alerts:read'),
  httpGetAlerts
);

router.post('/:alertId/dismiss',
  authenticateToken,
  requireFt2,
  requireAction('alerts:acknowledge'), // 410 Gone — kept for stale callers
  httpDismissAlert
);

router.post('/:alertId/acknowledge',
  authenticateToken,
  requireFt2,
  requireAction('alerts:acknowledge'),
  httpAcknowledgeAlert
);

router.post('/:alertId/snooze',
  authenticateToken,
  requireFt2,
  requireAction('alerts:snooze'),
  httpSnoozeAlert
);

router.post('/:alertId/resolve',
  authenticateToken,
  requireFt2,
  requireAction('alerts:resolve'),  // owner/admin only — enforced here + in controller
  httpResolveAlert
);

/**
 * ALERT RULES (PP3-01)
 * --------------------
 * User-configurable rules evaluated on order arrival.
 * Owner/admin only — operators cannot configure rules.
 *
 * SECURITY FIX (audit ISS-P10 / alerts.rules): routes previously had
 * zero tier enforcement despite alerts.rules being a documented Growth
 * feature (PLAN_FEATURES in usePlanEntitlement.ts, gated via ModuleTabBar
 * in AlertsPage.tsx). requireTier('growth') added to match.
 */
router.get('/rules',
  authenticateToken,
  requireFt2,
  requireTier('growth'),
  requireAction('alerts:rules:read'),
  httpGetAlertRules
);

router.post('/rules',
  authenticateToken,
  requireFt2,
  requireTier('growth'),
  requireAction('alerts:rules:write'),
  httpCreateAlertRule
);

router.delete('/rules/:ruleId',
  authenticateToken,
  requireFt2,
  requireTier('growth'),
  requireAction('alerts:rules:write'),
  httpDeleteAlertRule
);

export default router;