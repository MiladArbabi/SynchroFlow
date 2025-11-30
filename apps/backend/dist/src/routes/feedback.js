"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// packages/api/src/routes/feedback.ts
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const auth_middleware_1 = require("api-src/middleware/auth.middleware");
const feedbackService_1 = require("api-src/services/feedbackService");
const router = (0, express_1.Router)();
// Validation schema
const feedbackSchema = zod_1.z.object({
    insightId: zod_1.z.string().min(1, 'Insight ID is required'),
    triggerType: zod_1.z.enum(['coach', 'action', 'automation', 'orchestration']),
    action: zod_1.z.enum(['accepted', 'dismissed', 'ignored']),
    feedback: zod_1.z.object({
        reason: zod_1.z.enum(['not_relevant', 'incorrect', 'already_done']).optional(),
        context: zod_1.z.string().optional(),
    }).optional(),
});
// POST /api/v1/feedback - Record user feedback on insights
router.post('/', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        // Validate request body
        const validationResult = feedbackSchema.safeParse(req.body);
        if (!validationResult.success) {
            return res.status(400).json({
                error: 'Invalid feedback data',
                details: validationResult.error.message,
            });
        }
        const { insightId, triggerType, action, feedback } = validationResult.data;
        const userId = req.user?.id;
        const shopId = req.user?.shop_id;
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        // Insert feedback into database
        const [feedbackRecord] = await (0, db_1.default)('insight_feedback')
            .insert({
            insight_id: insightId,
            trigger_type: triggerType,
            feedback_action: action,
            feedback_reason: feedback?.reason,
            feedback_context: feedback?.context,
            user_id: userId,
            shop_id: shopId,
        })
            .returning('*');
        res.status(201).json({
            message: 'Feedback recorded successfully',
            feedback: {
                id: feedbackRecord.id,
                insightId: feedbackRecord.insight_id,
                action: feedbackRecord.feedback_action,
                recordedAt: feedbackRecord.created_at,
            },
        });
    }
    catch (error) {
        console.error('Error recording feedback:', error);
        res.status(500).json({
            error: 'Failed to record feedback',
            details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
        });
    }
});
// GET /api/v1/feedback/insights/:insightId - Get feedback for a specific insight
router.get('/insights/:insightId', auth_middleware_1.authenticateToken, async (req, res) => {
    try {
        const { insightId } = req.params;
        const userId = req.user?.id;
        const feedback = await feedbackService_1.FeedbackService.getFeedbackForInsight(insightId, userId);
        res.json({ feedback });
    }
    catch (error) {
        console.error('Error fetching feedback:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});
exports.default = router;
