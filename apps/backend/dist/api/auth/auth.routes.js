"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/api/auth/auth.routes.ts
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const router = (0, express_1.Router)();
// Wires POST /api/v1/auth/register
router.post('/register', auth_controller_1.registerUser);
// Wires POST /api/v1/auth/login
router.post('/login', auth_controller_1.loginUser);
// Wires POST /api/v1/auth/refresh_token
router.post('/refresh_token', auth_controller_1.refreshToken);
// Wires POST /api/v1/auth/logout
router.post('/logout', auth_controller_1.logoutUser);
router.get('/dev-token', auth_controller_1.getDevToken);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map