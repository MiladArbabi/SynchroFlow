"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/api/products/products.routes.ts
const express_1 = require("express");
const products_controller_1 = require("./products.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get('/', auth_middleware_1.authenticateToken, (req, res, next) => {
    console.log('[DEBUG] Products route: GET /api/v1/products hit');
    next();
}, products_controller_1.fetchProducts);
exports.default = router;
//# sourceMappingURL=products.routes.js.map