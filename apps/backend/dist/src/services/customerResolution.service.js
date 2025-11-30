"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerResolutionService = void 0;
// packages/api/src/services/customerResolution.service.ts
const db_1 = __importDefault(require("../db"));
class CustomerResolutionService {
    /**
     * Resolve customer identity across orders and customer objects
     * This creates a unified customer view without accessing protected data
     */
    async resolveCustomerFromOrder(shopId, platformOrderId) {
        // 1. Get order with customer ID
        const order = await (0, db_1.default)('orders')
            .select('platform_customer_id', 'customer_name', 'order_number', 'total_price', 'created_at')
            .where({ shop_id: shopId, platform_order_id: platformOrderId })
            .first();
        if (!order) {
            throw new Error('Order not found');
        }
        if (!order.platform_customer_id) {
            return this.createAnonymousCustomerProfile(order);
        }
        // 2. Get PCD customer data
        const customer = await (0, db_1.default)('pcd_customers')
            .select('*')
            .where({ shop_id: shopId, platform_customer_id: order.platform_customer_id })
            .first();
        // 3. Merge order and customer data
        return this.mergeCustomerProfiles(order, customer);
    }
    createAnonymousCustomerProfile(order) {
        const lastOrderDate = new Date(order.created_at);
        const daysSinceLastOrder = Math.floor((new Date().getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24));
        return {
            // From order data (PCD-compliant)
            display_name: order.customer_name || `Customer #${order.order_number}`,
            order_count: 1,
            total_spent: parseFloat(order.total_price) || 0,
            segment: 'new',
            tags: [],
            // PCD restriction messaging
            contact_info: {
                email: 'Contact through Shopify admin (PCD restricted)',
                phone: 'Contact through Shopify admin (PCD restricted)'
            },
            // Behavioral data from single order
            behavior: {
                is_new_customer: true,
                average_order_value: parseFloat(order.total_price) || 0,
                last_order_date: order.created_at,
                days_since_last_order: daysSinceLastOrder
            }
        };
    }
    mergeCustomerProfiles(order, customer) {
        const lastOrderDate = new Date(order.created_at);
        const daysSinceLastOrder = Math.floor((new Date().getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24));
        return {
            // Identity (PCD-compliant)
            display_name: order.customer_name || `Customer #${order.order_number}`,
            platform_customer_id: customer?.platform_customer_id,
            // Behavioral metrics
            order_count: customer?.total_orders || 1,
            total_spent: parseFloat(customer?.total_spent) || parseFloat(order.total_price) || 0,
            average_order_value: parseFloat(customer?.average_order_value) || parseFloat(order.total_price) || 0,
            customer_segment: customer?.customer_segment || 'new',
            // Tags and categorization
            tags: customer?.tags ? JSON.parse(customer.tags) : [],
            loyalty_tier: this.calculateLoyaltyTier(customer),
            // Timeline
            first_order_date: customer?.platform_created_at || order.created_at,
            last_order_date: order.created_at,
            days_since_last_order: customer?.days_since_last_order || daysSinceLastOrder,
            // PCD restriction messaging
            contact_info: {
                email: 'Contact through Shopify admin (PCD restricted)',
                phone: 'Contact through Shopify admin (PCD restricted)'
            }
        };
    }
    calculateLoyaltyTier(customer) {
        if (!customer)
            return 'bronze';
        const totalSpent = parseFloat(customer.total_spent) || 0;
        if (totalSpent >= 5000)
            return 'platinum';
        if (totalSpent >= 1000)
            return 'gold';
        if (totalSpent >= 200)
            return 'silver';
        return 'bronze';
    }
}
exports.CustomerResolutionService = CustomerResolutionService;
