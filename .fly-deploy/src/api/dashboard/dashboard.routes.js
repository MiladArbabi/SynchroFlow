"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/api/dashboard/dashboard.routes.ts
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const dashboard_controller_1 = require("./dashboard.controller");
const router = (0, express_1.Router)();
// All dashboard routes are protected by the auth middleware
// GET /api/v1/dashboard/pulse
router.get('/pulse', auth_middleware_1.authenticateToken, dashboard_controller_1.getPulse);
// GET /api/v1/dashboard/inventory-health
router.get('/inventory-health', auth_middleware_1.authenticateToken, dashboard_controller_1.getInventoryHealth);
// GET /api/v1/dashboard/shipment-status
router.get('/shipment-status', auth_middleware_1.authenticateToken, dashboard_controller_1.getShipmentStatus);
// GET /api/v1/dashboard/cash-traps
router.get('/cash-traps', auth_middleware_1.authenticateToken, dashboard_controller_1.getCashTraps);
exports.default = router;
