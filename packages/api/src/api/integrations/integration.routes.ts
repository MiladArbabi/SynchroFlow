// packages/api/src/api/integrations/integration.routes.ts
import { Router } from 'express';
import { initiateOAuth } from './integration.controller';

const router = Router();

// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', initiateOAuth);

export default router;