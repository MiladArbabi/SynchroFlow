// apps/backend/src/api/integrations/integration.routes.ts
import { Router } from 'express';
import { 
  initiateOAuth, 
  handleOAuthCallback, 
  getSyncStatus, 
  preFlightCheck, 
  triggerManualSync, 
  requestSyncNotification 
} from './integration.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { triggerManualInitialSync } from './manualSync.controller.js';

const router = Router();

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', authenticateToken, initiateOAuth);

// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', handleOAuthCallback);

// Wires GET /api/v1/integrations/sync-status
router.get('/sync-status', authenticateToken, getSyncStatus);

// Wires GET /api/v1/integrations/pre-flight
router.get('/pre-flight', authenticateToken, preFlightCheck);

router.post(
  '/manual-initial-sync',
  authenticateToken,
  triggerManualInitialSync
);

router.post('/sync-notify', authenticateToken, requestSyncNotification);

// This new endpoint must be authenticated
/* router.get('/discovery-status', authenticateToken, getDiscoveryStatus);
 */

router.post('/sync/:integrationId', authenticateToken, triggerManualSync);
export default router;