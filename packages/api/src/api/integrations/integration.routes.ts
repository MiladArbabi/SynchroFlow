// packages/api/src/api/integrations/integration.routes.ts
import { Router } from 'express';
import { initiateOAuth, handleOAuthCallback } from './integration.controller';

const router = Router();

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', initiateOAuth);

// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', handleOAuthCallback);

export default router;