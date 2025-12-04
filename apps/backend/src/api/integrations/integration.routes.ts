// apps/backend/src/api/integrations/integration.routes.ts
import { Router } from 'express';
import { 
  initiateOAuth, 
  handleOAuthCallback, 
  getSyncStatus,
  preFlightCheck,
  triggerManualSync
} from './integration.controller';
import { authenticateToken } from '../../middleware/auth.middleware';

const router = Router();

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', authenticateToken, initiateOAuth);

// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', handleOAuthCallback);

// Wires GET /api/v1/integrations/sync-status
router.get('/sync-status', authenticateToken, getSyncStatus);

// Wires GET /api/v1/integrations/pre-flight
router.get('/pre-flight', authenticateToken, preFlightCheck);

// This new endpoint must be authenticated
/* router.get('/discovery-status', authenticateToken, getDiscoveryStatus);
 */

router.post('/sync/:integrationId', authenticateToken, triggerManualSync);
export default router;