"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/api/orders/orders.routes.ts
const express_1 = require("express");
const ordersController = __importStar(require("./orders.controller"));
const router = (0, express_1.Router)();
/**
 * @route   GET /api/v1/orders
 * @desc    Get a list of all orders.
 * @access  Private
 */
router.get('/', ordersController.httpGetAllOrders);
/**
 * @route   GET /api/v1/orders/:id/status
 * @desc    Get the current fulfillment status of a single order.
 * @access  Private
 */
router.get('/:id/status', ordersController.httpGetOrderStatus);
/**
 * @route   GET /api/v1/orders/:id/profitability
 * @desc    Get profitability metrics for a single order.
 * @access  Private
 */
router.get('/:id/profitability', ordersController.httpGetOrderProfitability);
/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get consolidated details for a single order.
 * @access  Private
 */
router.get('/:id', ordersController.httpGetOrderDetails);
exports.default = router;
