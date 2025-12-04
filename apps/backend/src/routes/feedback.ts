// apps/backend/src/routes/feedback.ts
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { FeedbackService } from 'api-src/services/feedbackService';

const router = Router();

// Validation schema
const feedbackSchema = z.object({
  insightId: z.string().min(1, 'Insight ID is required'),
  triggerType: z.enum(['coach', 'action', 'automation', 'orchestration']),
  action: z.enum(['accepted', 'dismissed', 'ignored']),
  feedback: z.object({
    reason: z.enum(['not_relevant', 'incorrect', 'already_done']).optional(),
    context: z.string().optional(),
  }).optional(),
});

// POST /api/v1/feedback - Record user feedback on insights
router.post('/', authenticateToken, async (req, res) => {
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
    const userId = (req.user as any)?.id;
    const shopId = (req.user as any)?.shop_id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Insert feedback into database
    const [feedbackRecord] = await db('insight_feedback')
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

  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ 
      error: 'Failed to record feedback',
      details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
    });
  }
});

// GET /api/v1/feedback/insights/:insightId - Get feedback for a specific insight
router.get('/insights/:insightId', authenticateToken, async (req, res) => {
  try {
    const { insightId } = req.params;
    const userId = (req.user as any)?.id;

    const feedback = await FeedbackService.getFeedbackForInsight(insightId, userId);

    res.json({ feedback });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

export default router;