"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/api/customers/customers.routes.ts
const express_1 = require("express");
const customers_controller_1 = require("./customers.controller");
const router = (0, express_1.Router)();
/**
* @route   GET /api/v1/customers
* @desc    Get a list of all customers for the authenticated shop
* @access  Private
*/
router.get('/', customers_controller_1.getCustomerList);
/**
 * @route   GET /api/v1/customers/:id
 * @desc    Get full customer details by ID
 * @access  Private
 */
router.get('/:id', customers_controller_1.getCustomerDetails);
exports.default = router;
//# sourceMappingURL=customers.routes.js.map