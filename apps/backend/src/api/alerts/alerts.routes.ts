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

const router = Router();

/**
 * @route   GET /api/v1/alerts
 * @desc    Ranked operator alert inbox for authenticated shop.
 * @access  Private
 */
router.get('/', authenticateToken, httpGetAlerts);

/**
 * @route   POST /api/v1/alerts/:alertId/dismiss
 * @desc    Operator dismisses an alert.
 * @access  Private
 */
router.post('/:alertId/dismiss',     authenticateToken, httpDismissAlert);

router.post('/:alertId/acknowledge', authenticateToken, httpAcknowledgeAlert);
router.post('/:alertId/snooze',      authenticateToken, httpSnoozeAlert);
router.post('/:alertId/resolve',     authenticateToken, httpResolveAlert);

/**
 * ALERT RULES (PP3-01)
 * --------------------
 * User-configurable rules evaluated on order arrival.
 */
router.get('/rules', authenticateToken, httpGetAlertRules);
router.post('/rules', authenticateToken, httpCreateAlertRule);
router.delete('/rules/:ruleId', authenticateToken, httpDeleteAlertRule);

export default router;