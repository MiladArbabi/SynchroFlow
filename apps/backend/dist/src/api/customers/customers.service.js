"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomersService = void 0;
const customer_resolution_service_1 = require("../../services/customer-resolution.service");
const db_1 = __importDefault(require("../../db"));
class CustomersService {
    /**
     * Get list of customers for a shop from database
     */
    static async getCustomerList(shopId) {
        try {
            const customers = await db_1.default
                .select('*')
                .from('customers')
                .where({ shop_id: shopId })
                .orderBy('created_at', 'desc');
            return customers;
        }
        catch (error) {
            console.error('Error fetching customer list:', error);
            throw new Error('Failed to fetch customers');
        }
    }
    /**
     * Get detailed customer data with identity resolution
     */
    static async getCustomerDetailsById(customerId, shopId) {
        try {
            // Get customer from database
            const customer = await db_1.default
                .select('*')
                .from('customers')
                .where({
                id: customerId,
                shop_id: shopId
            })
                .first();
            if (!customer) {
                return null;
            }
            // Get identity resolution data
            let resolution = undefined;
            try {
                resolution = await customer_resolution_service_1.CustomerResolutionService.findCustomersByEmail(shopId, customer.email);
            }
            catch (resolutionError) {
                console.warn('Customer resolution failed:', resolutionError);
                // Continue without resolution data
            }
            // Calculate metrics
            const aov = customer.total_orders > 0 ? customer.total_spent / customer.total_orders : 0;
            const ltv = customer.total_spent * 1.2; // Simple LTV projection
            // Parse tags
            const tags = customer.tags ? customer.tags.split(',').map((tag) => tag.trim()) : [];
            return {
                id: customer.id,
                profile: {
                    name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown Customer',
                    email: customer.email,
                    phone: customer.phone || '',
                    location: '', // TODO: Extract from customer data
                    joined_date: customer.created_at.toISOString(),
                    tags
                },
                metrics: {
                    total_revenue: parseFloat(customer.total_spent.toString()),
                    total_orders: customer.total_orders,
                    aov: parseFloat(aov.toFixed(2)),
                    ltv: parseFloat(ltv.toFixed(2))
                },
                resolution,
                orders: [], // TODO: Fetch orders for this customer
                tickets: [] // TODO: Fetch support tickets
            };
        }
        catch (error) {
            console.error('Error fetching customer details:', error);
            throw new Error('Failed to fetch customer details');
        }
    }
    /**
     * Get customer by email across all platforms (for resolution)
     */
    static async getCustomerByEmail(shopId, email) {
        try {
            const customer = await db_1.default
                .select('*')
                .from('customers')
                .where({
                shop_id: shopId,
                email
            })
                .first();
            return customer || null;
        }
        catch (error) {
            console.error('Error fetching customer by email:', error);
            throw new Error('Failed to fetch customer by email');
        }
    }
}
exports.CustomersService = CustomersService;
