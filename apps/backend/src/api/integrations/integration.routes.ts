// apps/backend/src/api/integrations/integration.routes.ts
import { Router } from 'express';
import { 
  initiateOAuth, 
  handleOAuthCallback,
  handleShopifyInstall,
  getSyncStatus, 
  preFlightCheck, 
  triggerManualSync, 
  requestSyncNotification 
} from './integration.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { triggerManualInitialSync } from './manualSync.controller.js';

const router = Router();

// Wires GET /api/v1/integrations/shopify/install (unauthenticated — App Store entry point)
router.get('/shopify/install', handleShopifyInstall);

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', authenticateToken, requireAction('integrations:write'), initiateOAuth);

// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', handleOAuthCallback);

// Wires GET /api/v1/integrations/sync-status
router.get('/sync-status', authenticateToken, getSyncStatus);

// Wires GET /api/v1/integrations/pre-flight
router.get('/pre-flight', authenticateToken, preFlightCheck);

router.post(
  '/manual-initial-sync',
  authenticateToken,
  requireAction('integrations:write'),
  triggerManualInitialSync
);

router.post('/sync-notify', authenticateToken, requestSyncNotification);

// This new endpoint must be authenticated
/* router.get('/discovery-status', authenticateToken, getDiscoveryStatus);
 */

router.post('/sync/:integrationId', authenticateToken, requireAction('integrations:write'), triggerManualSync);
export default router;
