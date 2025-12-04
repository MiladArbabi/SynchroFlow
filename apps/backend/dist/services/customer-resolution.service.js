"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerResolutionService = void 0;
// apps/backend/src/services/customer-resolution.service.ts
const db_1 = __importDefault(require("../db"));
class CustomerResolutionService {
    /**
     * Resolve customer identity across multiple platforms
     */
    static async resolveCustomerIdentity(shopId, email, platformData) {
        // Generate unified customer ID (PCD compliant - no PII in ID)
        const unifiedCustomerId = this.generateUnifiedCustomerId(shopId, email);
        // Resolve the best identity from platform data
        const resolvedIdentity = await this.resolveBestIdentity(platformData);
        // Calculate confidence score
        const confidenceScore = this.calculateConfidenceScore(platformData, resolvedIdentity);
        // Determine resolution methods used
        const resolutionMethods = this.determineResolutionMethods(platformData);
        return {
            unified_customer_id: unifiedCustomerId,
            primary_email: email,
            platforms: platformData,
            resolved_identity: resolvedIdentity,
            confidence_score: confidenceScore,
            resolution_methods: resolutionMethods,
        };
    }
    /**
     * Generate a PCD-compliant unified customer ID
     */
    static generateUnifiedCustomerId(shopId, email) {
        // Use hash of shopId + email for PCD compliance
        const combined = `${shopId}:${email}`;
        // Simple hash function for demo - in production use proper hashing
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `cust_${Math.abs(hash)}`;
    }
    /**
     * Resolve the best identity from platform data
     */
    static async resolveBestIdentity(platformData) {
        // Start with most reliable platform (Shopify) and fall back to others
        const shopifyCustomer = platformData.find(p => p.platform === 'shopify');
        const klaviyoCustomer = platformData.find(p => p.platform === 'klaviyo');
        const stripeCustomer = platformData.find(p => p.platform === 'stripe');
        // Prefer Shopify data first, then Klaviyo, then Stripe
        const bestSource = shopifyCustomer || klaviyoCustomer || stripeCustomer || platformData[0];
        return {
            name: bestSource?.first_name && bestSource?.last_name
                ? `${bestSource.first_name} ${bestSource.last_name}`
                : bestSource?.first_name || undefined,
            email: bestSource?.email || '',
            phone: bestSource?.phone,
            location: this.extractLocationFromMetadata(bestSource?.metadata),
        };
    }
    /**
     * Check if platform data has conflicting personal information
     */
    static hasConflictingPersonalData(platformData) {
        if (platformData.length < 2)
            return false;
        // Check for name conflicts
        const names = platformData.map(p => `${p.first_name} ${p.last_name}`.toLowerCase().trim()).filter(name => name);
        if (new Set(names).size > 1)
            return true;
        // Check for phone conflicts  
        const phones = platformData.map(p => p.phone).filter(phone => phone);
        if (phones.length >= 2 && new Set(phones).size > 1)
            return true;
        return false;
    }
    /**
     * Calculate confidence score for the identity resolution
     */
    static calculateConfidenceScore(platformData, resolvedIdentity) {
        let score = 0;
        const factors = [];
        // Factor 1: Number of platforms with matching data
        const platformCount = platformData.length;
        if (platformCount >= 3)
            factors.push(0.3);
        else if (platformCount === 2)
            factors.push(0.2);
        else if (platformCount === 1)
            factors.push(0.1); // +0.1
        // Factor 2: Email consistency across platforms
        const emails = platformData.map(p => p.email).filter(Boolean);
        const uniqueEmails = new Set(emails);
        if (uniqueEmails.size === 1 && platformCount > 1) {
            // Check if we have other conflicting data (names, phones, etc.)
            const hasConflictingData = this.hasConflictingPersonalData(platformData);
            factors.push(hasConflictingData ? 0.2 : 0.4); // Reduce email score if other data conflicts
        }
        else if (uniqueEmails.size === 1)
            factors.push(0.2); // Single platform with email +0.2
        else if (uniqueEmails.size === platformData.length)
            factors.push(0.05); // Reduced from 0.1
        else
            factors.push(0.1); // Reduced from 0.2
        // Factor 3: Name consistency
        const names = platformData.map(p => `${p.first_name} ${p.last_name}`).filter(name => name.trim());
        const uniqueNames = new Set(names);
        if (uniqueNames.size === 1 && names.length > 1)
            factors.push(0.3); // Multiple platforms same name
        else if (uniqueNames.size === 1)
            factors.push(0.05); // Single platform with name +0.05 (reduced from 0.1)
        else if (uniqueNames.size > 0)
            factors.push(0.01); // Reduced from 0.02
        // Calculate total score (capped at 1.0)
        score = factors.reduce((sum, factor) => sum + factor, 0);
        return Math.min(score, 1.0);
    }
    /**
     * Determine which resolution methods were used
     */
    static determineResolutionMethods(platformData) {
        const methods = [];
        // Check for exact email matches
        const emails = platformData.map(p => p.email).filter(Boolean);
        if (new Set(emails).size < emails.length) {
            methods.push('email_exact_match');
        }
        // Check for phone matches
        const phones = platformData.map(p => p.phone).filter(Boolean);
        if (new Set(phones).size < phones.length) {
            methods.push('phone_match');
        }
        // Check for name matches
        const fullNames = platformData.map(p => `${p.first_name} ${p.last_name}`).filter(name => name.trim());
        if (new Set(fullNames).size < fullNames.length) {
            methods.push('name_match');
        }
        // If we have data from multiple platforms but no exact matches
        if (platformData.length > 1 && methods.length === 0) {
            methods.push('platform_correlation');
        }
        return methods.length > 0 ? methods : ['single_platform'];
    }
    /**
     * Extract location from platform metadata
     */
    static extractLocationFromMetadata(metadata) {
        if (!metadata)
            return undefined;
        // Try different location fields from different platforms
        const locationFields = [
            'default_address?.city',
            'addresses?.[0]?.city',
            'billing_address?.city',
            'shipping_address?.city',
            'location',
            'city'
        ];
        for (const field of locationFields) {
            const value = this.getNestedValue(metadata, field);
            if (value)
                return value;
        }
        return undefined;
    }
    /**
     * Get nested value from object using dot notation
     */
    static getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => {
            if (key.includes('?.')) {
                // Handle optional chaining
                const cleanKey = key.replace('?.', '');
                return current && current[cleanKey];
            }
            else if (key.includes('[') && key.includes(']')) {
                // Handle array notation: addresses[0].city
                const arrayMatch = key.match(/(\w+)\[(\d+)\]/);
                if (arrayMatch && current) {
                    const arrayName = arrayMatch[1];
                    const index = parseInt(arrayMatch[2]);
                    return current[arrayName] && current[arrayName][index];
                }
            }
            return current && current[key];
        }, obj);
    }
    /**
     * Find customers by email across all platforms for a shop
     */
    static async findCustomersByEmail(shopId, email) {
        try {
            // Get customer data from all platforms for this email
            const platformCustomers = [];
            // 1. Get Shopify customer
            const shopifyCustomer = await (0, db_1.default)('customers')
                .where({ shop_id: shopId, email })
                .first();
            if (shopifyCustomer) {
                platformCustomers.push({
                    platform: 'shopify',
                    platform_customer_id: shopifyCustomer.platform_customer_id,
                    email: shopifyCustomer.email,
                    first_name: shopifyCustomer.first_name,
                    last_name: shopifyCustomer.last_name,
                    phone: shopifyCustomer.phone,
                    metadata: {
                        total_orders: shopifyCustomer.total_orders,
                        total_spent: shopifyCustomer.total_spent,
                        state: shopifyCustomer.state,
                        tags: shopifyCustomer.tags,
                    }
                });
            }
            // 2. In the future: Get Klaviyo, Stripe, etc. customers
            // const klaviyoCustomer = await this.getKlaviyoCustomer(shopId, email);
            // if (klaviyoCustomer) platformCustomers.push(klaviyoCustomer);
            if (platformCustomers.length === 0) {
                return null;
            }
            // Resolve the unified identity
            return await this.resolveCustomerIdentity(shopId, email, platformCustomers);
        }
        catch (error) {
            console.error('Error finding customers by email:', error);
            throw new Error('Failed to resolve customer identity');
        }
    }
    /**
     * Get all unified customer profiles for a shop
     */
    static async getShopUnifiedCustomers(shopId) {
        try {
            // Get all Shopify customers for this shop
            const shopifyCustomers = await (0, db_1.default)('customers')
                .where({ shop_id: shopId })
                .select('email', 'platform_customer_id', 'first_name', 'last_name', 'phone');
            // Group by email and resolve identities
            const emailGroups = new Map();
            for (const customer of shopifyCustomers) {
                const platformCustomer = {
                    platform: 'shopify',
                    platform_customer_id: customer.platform_customer_id,
                    email: customer.email,
                    first_name: customer.first_name,
                    last_name: customer.last_name,
                    phone: customer.phone,
                };
                if (!emailGroups.has(customer.email)) {
                    emailGroups.set(customer.email, []);
                }
                emailGroups.get(customer.email).push(platformCustomer);
            }
            // Resolve identities for each email group
            const unifiedProfiles = [];
            for (const [email, platformData] of emailGroups.entries()) {
                const profile = await this.resolveCustomerIdentity(shopId, email, platformData);
                unifiedProfiles.push(profile);
            }
            return unifiedProfiles;
        }
        catch (error) {
            console.error('Error getting shop unified customers:', error);
            throw new Error('Failed to get unified customer profiles');
        }
    }
}
exports.CustomerResolutionService = CustomerResolutionService;
//# sourceMappingURL=customer-resolution.service.js.map