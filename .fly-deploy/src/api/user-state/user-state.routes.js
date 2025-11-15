"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/api/user-state/user-state.routes.ts
const express_1 = require("express");
const user_state_controller_1 = require("./user-state.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/state', auth_middleware_1.authenticateToken, user_state_controller_1.getUserState);
router.put('/mode', auth_middleware_1.authenticateToken, user_state_controller_1.updateUserMode);
exports.default = router;
