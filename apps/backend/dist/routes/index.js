"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/routes/index.ts
const express_1 = require("express");
// Placeholder routes - these will be implemented in future issues
const shops_1 = __importDefault(require("./shops"));
const integrations_1 = __importDefault(require("./integrations"));
const users_1 = __importDefault(require("./users"));
const dashboard_1 = __importDefault(require("./dashboard"));
const feedback_1 = __importDefault(require("./feedback"));
const orders_routes_1 = __importDefault(require("../api/orders/orders.routes"));
const products_routes_1 = __importDefault(require("../api/products/products.routes"));
const customers_routes_1 = __importDefault(require("../api/customers/customers.routes"));
const product_costs_routes_1 = __importDefault(require("../api/product-costs/product-costs.routes"));
const user_state_routes_1 = __importDefault(require("../api/user-state/user-state.routes"));
const specter_controller_1 = require("api-src/api/specter/specter.controller");
const router = (0, express_1.Router)();
router.use('/shops', shops_1.default);
router.use('/integrations', integrations_1.default);
router.use('/users', users_1.default);
router.use('/dashboard', dashboard_1.default);
router.use('/feedback', feedback_1.default);
router.use('/orders', orders_routes_1.default);
router.use('/products', products_routes_1.default);
router.use('/customers', customers_routes_1.default);
router.use('/product-costs', product_costs_routes_1.default);
router.use('/user-state', user_state_routes_1.default);
router.get('/v1/specter/config', specter_controller_1.getSpecterConfig);
router.put('/v1/specter/config', specter_controller_1.upsertSpecterConfig);
exports.default = router;
//# sourceMappingURL=index.js.map