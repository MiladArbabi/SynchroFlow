"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserStateService = void 0;
//packages/api/src/services/user-state.service.ts
const db_1 = __importDefault(require("../db"));
class UserStateService {
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
        return {
            user: {
                id: user.id,
                email: user.email,
                preferred_mode: user.preferred_mode,
                detected_mode: detectedMode,
                shopify_connected: user.shopify_connected,
                stripe_connected: user.stripe_connected,
                first_insight_delivered: user.first_insight_delivered,
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
}
exports.UserStateService = UserStateService;
