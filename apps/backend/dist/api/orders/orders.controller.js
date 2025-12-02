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
exports.httpGetOrderDetails = exports.httpGetOrderProfitability = exports.httpGetAllOrders = void 0;
const ordersService = __importStar(require("./orders.service"));
/**
 * @route   GET /api/v1/orders
 * @desc    Get a list of all orders.
 * @access  Private
 */
const httpGetAllOrders = async (req, res) => {
    try {
        const orders = await ordersService.getAllOrders();
        res.status(200).json(orders);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to fetch orders list: ${message}` });
    }
};
exports.httpGetAllOrders = httpGetAllOrders;
/**
 * @route   GET /api/v1/orders/:id/status
 * @desc    Get the current fulfillment status of a single order.
 * @access  Private
 */
/* export const httpGetOrderStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const status = await ordersService.getOrderStatusById(id);
    res.status(200).json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch order status for ${id}: ${message}` });
  }
}; */
/**
 * @route   GET /api/v1/orders/:id/profitability
 * @desc    Get profitability metrics for a single order.
 * @access  Private
 */
const httpGetOrderProfitability = async (req, res) => {
    const { id } = req.params;
    try {
        const profitability = await ordersService.getOrderProfitabilityById(id);
        res.status(200).json(profitability);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to fetch order profitability for ${id}: ${message}` });
    }
};
exports.httpGetOrderProfitability = httpGetOrderProfitability;
/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get consolidated details for a single order.
 * @access  Private
 */
const httpGetOrderDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const details = await ordersService.getOrderDetailsById(id);
        if (details) {
            res.status(200).json(details);
        }
        else {
            res.status(404).json({ error: `Order with ID ${id} not found.` });
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to fetch order details for ${id}: ${message}` });
    }
};
exports.httpGetOrderDetails = httpGetOrderDetails;
//# sourceMappingURL=orders.controller.js.map