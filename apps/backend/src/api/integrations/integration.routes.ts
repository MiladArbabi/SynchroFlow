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
import { disconnectShopify, getShopifyDisconnectCapability, reconcileShopifyDisconnect } from './shopifyDisconnect.controller.js';
import type { NextFunction, Request, Response } from 'express';

const router = Router();

// Wires GET /api/v1/integrations/shopify/install (unauthenticated — App Store entry point)
router.get('/shopify/install', handleShopifyInstall);

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', authenticateToken, requireAction('integrations:write'), initiateOAuth);

// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', handleOAuthCallback);

// Wires GET /api/v1/integrations/sync-status
router.get('/sync-status', authenticateToken, getSyncStatus);

// Same current-user authority as connection writes; no WMS settings grant.
// Route-local boundary keeps authority lookup failures fail-closed on Express 4.
const requireConnectionWrite = requireAction('integrations:write');
const requireConnectionWriteSafely = (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(requireConnectionWrite(req, res, next)).catch((error: unknown) => {
    console.error('[integration.routes] Connection permission authority unavailable', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    if (res.headersSent) return next(error);
    return res.status(503).json({ error: 'PERMISSION_AUTHORITY_UNAVAILABLE', retryable: true });
  });
};
router.get('/capabilities', authenticateToken, requireConnectionWriteSafely,
  (_req, res) => res.json({ canManageConnection: true }));

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

// GH-979 C: owner-only (current DB membership), deliberately not integrations:write.
router.get('/shopify/disconnect/capability', authenticateToken, getShopifyDisconnectCapability);
router.post('/shopify/disconnect', authenticateToken, disconnectShopify);
router.post('/shopify/disconnect/reconcile', authenticateToken, reconcileShopifyDisconnect);
export default router;
