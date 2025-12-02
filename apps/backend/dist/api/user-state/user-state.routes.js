"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_state_controller_1 = require("./user-state.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/state', auth_middleware_1.authenticateToken, user_state_controller_1.getUserState);
router.get('/onboarding-progress', auth_middleware_1.authenticateToken, user_state_controller_1.getOnboardingProgress);
router.put('/mode', auth_middleware_1.authenticateToken, user_state_controller_1.updateUserMode);
router.get('/product-costs', auth_middleware_1.authenticateToken, user_state_controller_1.getUserProductCosts);
router.post('/product-costs', auth_middleware_1.authenticateToken, user_state_controller_1.updateUserProductCosts);
exports.default = router;
//# sourceMappingURL=user-state.routes.js.map