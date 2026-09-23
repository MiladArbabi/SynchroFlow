// apps/backend/src/api/notifications/notifications.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import {
  getNotificationConditions,
  getPushStatus,
  getRecentNotifications,
  markRecentNotificationClicked,
  markRecentNotificationRead,
  subscribeWeb,
  subscribeExpo,
  unsubscribe,
} from './notifications.controller.js';

/**
 * PUSH SUBSCRIPTION ROUTES (WM-22)
 * ----------------------------------
 * Manage push subscriptions for Web Push and Expo.
 *
 * All routes require authentication and FT2 lifecycle state.
 */
const router = Router();

router.get(
  '/conditions',
  authenticateToken,
  requireFt2,
  getNotificationConditions,
);
router.get('/push-status', authenticateToken, requireFt2, getPushStatus);
router.get('/recent', authenticateToken, requireFt2, getRecentNotifications);
router.patch('/recent/:notificationId/read', authenticateToken, requireFt2, markRecentNotificationRead);
router.patch('/recent/:notificationId/click', authenticateToken, requireFt2, markRecentNotificationClicked);
router.post('/subscribe/web', authenticateToken, requireFt2, subscribeWeb);
router.post('/subscribe/expo', authenticateToken, requireFt2, subscribeExpo);
router.delete('/unsubscribe', authenticateToken, requireFt2, unsubscribe);

export default router;
