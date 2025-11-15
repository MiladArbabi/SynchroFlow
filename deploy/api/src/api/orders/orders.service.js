"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderDetailsById = exports.getOrderProfitabilityById = exports.getOrderStatusById = exports.getAllOrders = void 0;
// packages/api/src/api/orders/orders.service.ts
const path_1 = __importDefault(require("path"));
// Load the C++ addon. Adjust the path based on build output location if needed.
const addonPath = process.env.NODE_ENV === 'test'
    ? path_1.default.join(__dirname, '../../../../../packages/core-engine/build/Release/sf_core.node') // Adjust path for tests if necessary
    : path_1.default.join(__dirname, '../../sf_core.node'); // Adjust path relative to the compiled server.js in 'dist'
let addon;
try {
    addon = require(addonPath);
    console.log("Successfully loaded C++ Core Engine addon.");
    // Optionally call reloadCacheSync here if needed on startup
}
catch (error) {
    console.error("!!! FAILED TO LOAD C++ CORE ENGINE ADDON !!!", error);
    // Fallback or throw error depending on requirements
    addon = {
        getOrderStatus: (orderId) => ({ orderId: orderId, status: "Error: Addon Failed" })
    };
}
// --- MOCK DATA ---
const mockOrders = [
    { id: '1001', customer_name: 'Alice Smith', total: 50.00, status: 'Pending', created_at: new Date() },
    { id: '1002', customer_name: 'Bob Johnson', total: 75.50, status: 'Shipped', created_at: new Date() },
    { id: '1003', customer_name: 'Charlie Brown', total: 120.00, status: 'Picking', created_at: new Date() },
];
// --- MOCK CUSTOMER DATA (for Order 360) ---
// In a real app, we'd fetch this via a relation.
const mockCustomerProfile = {
    name: 'John Doe (from Order)',
    email: 'john.doe@example.com',
    phone: '555-1234',
    tags: ['VIP'],
    shippingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    billingAddress: { street: '123 Main St', city: 'Anytown', state: 'CA', zip: '12345', country: 'USA' },
    accountCreated: '2024-01-15T10:00:00Z',
    source: 'Shopify',
};
const mockCustomerMetrics = {
    ltv: 1204.50,
    aov: 110.40,
    totalOrders: 11,
    totalMargin: 550.25,
    lastOrderDate: '2025-10-15T09:30:00Z',
};
// --- END MOCK DATA ---
/**
 * Simulates fetching a list of all orders.
 */
const getAllOrders = async () => {
    // In v2, this will be: return db('orders').select('*');
    return mockOrders;
};
exports.getAllOrders = getAllOrders;
/**
 * Simulates fetching the status for a single order.
 * @param id The order ID
 */
const getOrderStatusById = async (id) => {
    console.log(`Calling C++ addon getOrderStatus for ID: ${id}`);
    const result = addon.getOrderStatus(id); // Call the C++ function
    console.log(`C++ addon returned:`, result);
    return result; // Return the object { orderId: string, status: string }
};
exports.getOrderStatusById = getOrderStatusById;
/**
 * Simulates fetching the profitability for a single order.
 * @param id The order ID
 */
const getOrderProfitabilityById = async (id) => {
    // In v2, this will be a real calculation
    return {
        orderId: id,
        revenue: 149.99,
        cogs: 62.50,
        shippingCost: 12.00,
        fees: 4.50,
        margin: 70.99,
        marginPercent: 47.3
    };
};
exports.getOrderProfitabilityById = getOrderProfitabilityById;
/**
 * Simulates fetching all data for the Order 360 page.
 * @param id The order ID
 */
const getOrderDetailsById = async (id) => {
    // Find the basic order info from our list
    const orderInfo = mockOrders.find(o => o.id === id);
    if (!orderInfo) {
        return null; // Order not found
    }
    const statusResult = await (0, exports.getOrderStatusById)(id); // This now calls C++
    const profitability = await (0, exports.getOrderProfitabilityById)(id);
    return {
        id: orderInfo.id,
        customer: {
            profile: mockCustomerProfile,
            metrics: mockCustomerMetrics,
        },
        status: statusResult.status,
        profitability: profitability,
    };
};
exports.getOrderDetailsById = getOrderDetailsById;
