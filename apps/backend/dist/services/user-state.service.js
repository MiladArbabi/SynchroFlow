"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserStateService = void 0;
//apps/backend/src/services/user-state.service.ts
const db_1 = __importDefault(require("../db"));
class UserStateService {
    /**
      * Detect user's onboarding tier based on PCD status and platform connections
      */
    static async detectOnboardingTier(userId) {
        const user = await (0, db_1.default)('users').where({ id: userId }).first();
        if (!user) {
            return 'BASIC_ACCESS';
        }
        // Check if user has PCD-approved access (we'll need to implement this check)
        const hasPCDAccess = await this.checkPCDAccess(userId);
        if (hasPCDAccess) {
            return 'PCD_APPROVED';
        }
        // Check if user has attempted PCD access but is pending
        const hasPendingPCD = await this.hasPendingPCDAccess(userId);
        if (hasPendingPCD) {
            return 'PCD_PENDING';
        }
        return 'BASIC_ACCESS';
    }
    /**
     * Check if user has PCD-approved access
     */
    static async checkPCDAccess(userId) {
        // For now, return false - we'll implement actual PCD check later
        // This would check if the Shopify app has PCD permissions
        return false;
    }
    /**
     * Check if user has pending PCD access
     */
    static async hasPendingPCDAccess(userId) {
        // Check if user has Shopify connected but no PCD access yet
        const user = await (0, db_1.default)('users').where({ id: userId }).first();
        return user?.shopify_connected === true;
    }
    /**
     * Get user's connected platforms
     */
    static async getConnectedPlatforms(userId) {
        const user = await (0, db_1.default)('users').where({ id: userId }).first();
        const connected = [];
        if (user?.shopify_connected) {
            connected.push('shopify');
        }
        if (user?.stripe_connected) {
            connected.push('stripe');
        }
        // Add other platform checks as we implement them
        return connected;
    }
    /**
     * Get onboarding progress and recommendations
     */
    static async getOnboardingProgress(userId) {
        const tier = await this.detectOnboardingTier(userId);
        const connectedPlatforms = await this.getConnectedPlatforms(userId);
        const userState = await this.getUserState(userId);
        return {
            tier,
            connectedPlatforms,
            recommendedNextSteps: this.getRecommendedNextSteps(tier, connectedPlatforms),
            unlockedFeatures: this.getUnlockedFeatures(tier, connectedPlatforms),
            userState
        };
    }
    /**
     * Get recommended next steps based on current tier and platforms
     */
    static getRecommendedNextSteps(tier, platforms) {
        const steps = [];
        if (tier === 'BASIC_ACCESS') {
            steps.push('Connect Shopify store to unlock order and customer data');
            if (!platforms.includes('shopify')) {
                steps.push('Complete Shopify app installation for PCD access');
            }
        }
        if (tier === 'PCD_PENDING') {
            steps.push('Request PCD access approval from Shopify');
            steps.push('Connect financial platforms (QuickBooks, Stripe) for profitability insights');
        }
        if (tier === 'PCD_APPROVED') {
            if (!platforms.includes('stripe')) {
                steps.push('Connect Stripe for payment analytics and fee tracking');
            }
            if (!platforms.includes('quickbooks')) {
                steps.push('Connect QuickBooks for true cost accounting');
            }
            steps.push('Explore advanced analytics and financial intelligence features');
        }
        return steps;
    }
    /**
     * Get unlocked features based on tier and platforms
     */
    static getUnlockedFeatures(tier, platforms) {
        const features = [
            'Basic dashboard widgets',
            'Product inventory tracking'
        ];
        if (platforms.includes('shopify')) {
            features.push('Order management');
            features.push('Customer profiles (limited)');
        }
        if (tier === 'PCD_APPROVED') {
            features.push('Full customer intelligence');
            features.push('Cross-platform analytics');
        }
        if (platforms.includes('stripe')) {
            features.push('Payment analytics');
            features.push('Revenue tracking');
        }
        if (platforms.includes('quickbooks')) {
            features.push('True profitability');
            features.push('Cost accounting');
        }
        return features;
    }
    /**
     * Detect the appropriate mode for a user based on their current state
     */
    static async detectUserMode(userId) {
        const user = await (0, db_1.default)('users')
            .where({ id: userId })
            .first();
        if (!user) {
            return 'survival';
        }
        // 1. Respect user preference first
        if (user.preferred_mode) {
            return user.preferred_mode;
        }
        // 2. Basic rules based on integration and data maturity
        if (!user.shopify_connected) {
            return 'survival';
        }
        if (!user.first_insight_delivered) {
            return 'survival';
        }
        // 3. Simple plan-based defaults (we'll enhance this later)
        // For now, all users get 'survival' until we have plan data
        return 'survival';
    }
    /**
     * Get complete user state including mode and milestones
     */
    static async getUserState(userId) {
        const user = await (0, db_1.default)('users')
            .where({ id: userId })
            .first();
        if (!user) {
            throw new Error('User not found');
        }
        const milestones = await (0, db_1.default)('user_milestones')
            .where({ user_id: userId })
            .orderBy('achieved_at', 'desc');
        const detectedMode = await this.detectUserMode(userId);
        const onboardingTier = await this.detectOnboardingTier(userId);
        const connectedPlatforms = await this.getConnectedPlatforms(userId);
        const ordersPerMonthSegment = await this.getOrdersPerMonthSegment(userId);
        return {
            user: {
                id: user.id,
                email: user.email,
                preferred_mode: user.preferred_mode,
                detected_mode: detectedMode,
                onboarding_tier: onboardingTier,
                connected_platforms: connectedPlatforms,
                shopify_connected: user.shopify_connected,
                stripe_connected: user.stripe_connected,
                first_insight_delivered: user.first_insight_delivered,
                orders_per_month_segment: ordersPerMonthSegment,
            },
            milestones,
            current_mode: user.preferred_mode || detectedMode,
        };
    }
    /**
     * Update user's preferred mode
     */
    static async updatePreferredMode(userId, mode) {
        await (0, db_1.default)('users')
            .where({ id: userId })
            .update({
            preferred_mode: mode,
            updated_at: db_1.default.fn.now(),
        });
    }
    /**
     * Record a milestone for a user
     */
    static async recordMilestone(userId, milestone) {
        await (0, db_1.default)('user_milestones').insert({
            user_id: userId,
            milestone,
            achieved_at: db_1.default.fn.now(),
        }).onConflict(['user_id', 'milestone']).ignore(); // Don't duplicate milestones
    }
    /**
     * Get the user's orders_per_month_segment from user_states
     */
    static async getOrdersPerMonthSegment(userId) {
        const row = await (0, db_1.default)('user_states')
            .where({ user_id: userId, key: 'orders_per_month_segment' })
            .first();
        if (!row) {
            return null;
        }
        const raw = row.value;
        if (raw == null) {
            return null;
        }
        // If stored as a plain string in JSONB
        if (typeof raw === 'string') {
            const allowed = [
                '1-50',
                '51-200',
                '201-500',
                '501-1000',
                '1000+',
            ];
            return allowed.includes(raw) ? raw : null;
        }
        // If stored as an object like { segment: "51-200" } (future-proofing)
        if (typeof raw === 'object' && typeof raw.segment === 'string') {
            const candidate = raw.segment;
            const allowed = [
                '1-50',
                '51-200',
                '201-500',
                '501-1000',
                '1000+',
            ];
            return allowed.includes(candidate)
                ? candidate
                : null;
        }
        // Unknown format → treat as unset
        return null;
    }
    /**
     * Update the user's orders_per_month_segment in user_states
     */
    static async updateOrdersPerMonthSegment(userId, segment) {
        const payload = { segment }; // valid JSON, plays nicely with jsonb
        await (0, db_1.default)('user_states')
            .insert({
            user_id: userId,
            key: 'orders_per_month_segment',
            value: payload,
            updated_at: db_1.default.fn.now(),
        })
            .onConflict(['user_id', 'key'])
            .merge({
            value: payload,
            updated_at: db_1.default.fn.now(),
        });
    }
    /**
     * Get user's product costs from user_state
     */
    static async getUserProductCosts(userId) {
        const userState = await (0, db_1.default)('user_states')
            .where({ user_id: userId, key: 'product_costs' })
            .first();
        if (!userState) {
            return {};
        }
        // Handle both stringified JSON and direct object storage
        if (typeof userState.value === 'string') {
            try {
                return JSON.parse(userState.value);
            }
            catch (error) {
                console.error('Error parsing user state JSON:', error);
                return {};
            }
        }
        // If it's already an object, return it directly
        return userState.value || {};
    }
    /**
     * Update user's product costs in user_state
     */
    static async updateUserProductCosts(userId, productCosts) {
        await (0, db_1.default)('user_states')
            .insert({
            user_id: userId,
            key: 'product_costs',
            value: productCosts, // Store as JSONB directly
            updated_at: db_1.default.fn.now()
        })
            .onConflict(['user_id', 'key'])
            .merge({
            value: productCosts, // Store as JSONB directly
            updated_at: db_1.default.fn.now()
        });
    }
}
exports.UserStateService = UserStateService;
;
//# sourceMappingURL=user-state.service.js.map