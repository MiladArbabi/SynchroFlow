"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderDetailsById = exports.getOrderProfitabilityById = exports.getAllOrders = void 0;
// apps/backend/src/api/orders/orders.service.ts
const db_1 = __importDefault(require("../../db"));
/**
 * Get all orders for a shop from database
 */
const getAllOrders = async () => {
    try {
        // TODO: Get shopId from authenticated user/session
        // For now, using shopId 1 as placeholder
        const shopId = 1;
        const orders = await (0, db_1.default)('orders')
            .select('platform_order_id as id', 'order_number', 'financial_status', 'fulfillment_status as status', 'total_price as total', 'created_at')
            .where('shop_id', shopId)
            .orderBy('created_at', 'desc');
        // Since we don't have shipping_address, we'll create a placeholder customer name
        return orders.map(order => ({
            ...order,
            customer_name: `Customer #${order.order_number}`
        }));
    }
    catch (error) {
        console.error('[OrdersService] Error fetching orders:', error);
        throw new Error('Failed to fetch orders');
    }
};
exports.getAllOrders = getAllOrders;
/**
 * Get order profitability by ID
 */
const getOrderProfitabilityById = async (id) => {
    try {
        const shopId = 1;
        // Try to find order by the provided ID (could be numeric or full GID)
        let order = await (0, db_1.default)('orders')
            .select('total_price')
            .where({
            shop_id: shopId,
            platform_order_id: id
        })
            .first();
        // If not found with the provided ID, try with the full Shopify GID format
        if (!order && /^\d+$/.test(id)) {
            order = await (0, db_1.default)('orders')
                .select('total_price')
                .where({
                shop_id: shopId,
                platform_order_id: `gid://shopify/Order/${id}`
            })
                .first();
        }
        if (!order) {
            throw new Error('Order not found');
        }
        // Simplified profitability calculation using only total_price for now
        const revenue = order.total_price;
        const cogs = revenue * 0.6; // Assume 60% COGS for now
        const shippingCost = revenue * 0.1; // Assume 10% shipping cost
        const fees = revenue * 0.03; // Assume 3% fees
        const margin = revenue - cogs - shippingCost - fees;
        const marginPercent = (margin / revenue) * 100;
        return {
            orderId: id,
            revenue,
            cogs,
            shippingCost,
            fees,
            margin,
            marginPercent: Math.round(marginPercent * 10) / 10
        };
    }
    catch (error) {
        console.error('[OrdersService] Error calculating profitability:', error);
        throw new Error('Failed to calculate order profitability');
    }
};
exports.getOrderProfitabilityById = getOrderProfitabilityById;
/**
 * Get comprehensive order details for Order360 page
 */
const getOrderDetailsById = async (id) => {
    try {
        const shopId = 1;
        // Try to find order by the provided ID (could be numeric or full GID)
        let order = await (0, db_1.default)('orders')
            .select('*')
            .where({
            shop_id: shopId,
            platform_order_id: id
        })
            .first();
        // If not found with the provided ID, try with the full Shopify GID format
        if (!order && /^\d+$/.test(id)) {
            order = await (0, db_1.default)('orders')
                .select('*')
                .where({
                shop_id: shopId,
                platform_order_id: `gid://shopify/Order/${id}`
            })
                .first();
        }
        if (!order) {
            console.log(`[OrdersService] Order not found for ID: ${id}`);
            return null;
        }
        console.log(`[OrdersService] Found order: ${order.order_number} with customer: ${order.customer_name}`);
        const profitability = await (0, exports.getOrderProfitabilityById)(id);
        // Parse shipping address from JSON string
        let shippingAddress = {};
        try {
            shippingAddress = order.shipping_address ? JSON.parse(order.shipping_address) : {};
        }
        catch (e) {
            console.warn('Failed to parse shipping address JSON:', e);
        }
        return {
            id: order.platform_order_id,
            status: mapFulfillmentStatus(order.fulfillment_status),
            customer: {
                profile: {
                    name: order.customer_name || `Customer #${order.order_number}`,
                    email: 'Contact customer through Shopify admin (PCD restricted)',
                    phone: 'Contact customer through Shopify admin (PCD restricted)',
                    tags: [],
                    shippingAddress: {}, // Empty due to PCD restrictions
                    billingAddress: {}, // Empty due to PCD restrictions
                    accountCreated: order.created_at,
                    source: order.source_name || 'Unknown'
                },
                metrics: {
                    ltv: 0,
                    aov: order.total_price,
                    totalOrders: 1,
                    totalMargin: profitability.margin,
                    lastOrderDate: order.created_at
                }
            },
            profitability
        };
    }
    catch (error) {
        console.error('[OrdersService] Error fetching order details:', error);
        throw new Error('Failed to fetch order details');
    }
};
exports.getOrderDetailsById = getOrderDetailsById;
/**
 * Map fulfillment status to our OrderStatus
 */
const mapFulfillmentStatus = (fulfillmentStatus) => {
    const statusMap = {
        'fulfilled': 'shipped',
        'partial': 'picking',
        'pending': 'pending',
        'null': 'pending'
    };
    return statusMap[fulfillmentStatus] || 'pending';
};
//# sourceMappingURL=orders.service.js.map