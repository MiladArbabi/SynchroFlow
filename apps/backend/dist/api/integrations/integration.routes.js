"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/api/integrations/integration.routes.ts
const express_1 = require("express");
const integration_controller_1 = require("./integration.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const router = (0, express_1.Router)();
// Wires GET /api/v1/integrations/oauth/initiate
router.get('/oauth/initiate', auth_middleware_1.authenticateToken, integration_controller_1.initiateOAuth);
// Wires GET /api/v1/integrations/oauth/callback/:platform
router.get('/oauth/callback/:platform', integration_controller_1.handleOAuthCallback);
// Wires GET /api/v1/integrations/sync-status
router.get('/sync-status', auth_middleware_1.authenticateToken, integration_controller_1.getSyncStatus);
// Wires GET /api/v1/integrations/pre-flight
router.get('/pre-flight', auth_middleware_1.authenticateToken, integration_controller_1.preFlightCheck);
// This new endpoint must be authenticated
/* router.get('/discovery-status', authenticateToken, getDiscoveryStatus);
 */
router.post('/sync/:integrationId', auth_middleware_1.authenticateToken, integration_controller_1.triggerManualSync);
exports.default = router;
//# sourceMappingURL=integration.routes.js.map