// apps/backend/src/api/alerts/alerts.routes.ts

import { Router } from 'express';
import { httpGetAlerts, httpDismissAlert } from './alerts.controller.js';
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
router.post('/:alertId/dismiss', authenticateToken, httpDismissAlert);

export default router;