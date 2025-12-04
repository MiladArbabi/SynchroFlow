"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackService = void 0;
//apps/backend/src/services/feedbackService.ts
const api_db_1 = __importDefault(require("api-db"));
class FeedbackService {
    /**
     * Record user feedback on an insight
     */
    static async recordFeedback(data) {
        const [record] = await (0, api_db_1.default)('insight_feedback')
            .insert({
            insight_id: data.insightId,
            trigger_type: data.triggerType,
            feedback_action: data.action,
            feedback_reason: data.feedback?.reason,
            feedback_context: data.feedback?.context,
            user_id: data.userId,
            shop_id: data.shopId,
        })
            .returning('*');
        return record;
    }
    /**
     * Get feedback for a specific insight
     */
    static async getFeedbackForInsight(insightId, userId) {
        return (0, api_db_1.default)('insight_feedback')
            .where({
            insight_id: insightId,
            user_id: userId,
        })
            .orderBy('created_at', 'desc');
    }
    /**
     * Get feedback statistics for a user/shop
     */
    static async getFeedbackStats(userId, shopId) {
        const query = (0, api_db_1.default)('insight_feedback').where('user_id', userId);
        if (shopId) {
            query.andWhere('shop_id', shopId);
        }
        const feedback = await query;
        const byAction = feedback.reduce((acc, item) => {
            acc[item.feedback_action] = (acc[item.feedback_action] || 0) + 1;
            return acc;
        }, {});
        const byTriggerType = feedback.reduce((acc, item) => {
            acc[item.trigger_type] = (acc[item.trigger_type] || 0) + 1;
            return acc;
        }, {});
        return {
            total: feedback.length,
            byAction,
            byTriggerType,
        };
    }
    /**
     * Check if user has already provided feedback for an insight
     */
    static async hasProvidedFeedback(insightId, userId) {
        const count = await (0, api_db_1.default)('insight_feedback')
            .where({
            insight_id: insightId,
            user_id: userId,
        })
            .count('id as count')
            .first();
        return parseInt(count?.count) > 0;
    }
}
exports.FeedbackService = FeedbackService;
//# sourceMappingURL=feedbackService.js.map