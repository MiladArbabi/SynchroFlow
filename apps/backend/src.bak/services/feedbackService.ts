//apps/backend/src/services/feedbackService.ts
import db from "api-db";

export interface FeedbackData {
  insightId: string;
  triggerType: 'coach' | 'action' | 'automation' | 'orchestration';
  action: 'accepted' | 'dismissed' | 'ignored';
  feedback?: {
    reason?: 'not_relevant' | 'incorrect' | 'already_done';
    context?: string;
  };
  userId: number;
  shopId?: number;
}

export interface FeedbackRecord {
  id: string;
  insight_id: string;
  trigger_type: string;
  feedback_action: string;
  feedback_reason?: string;
  feedback_context?: string;
  user_id: number;
  shop_id?: number;
  created_at: Date;
  updated_at: Date;
}

export class FeedbackService {
  /**
   * Record user feedback on an insight
   */
  static async recordFeedback(data: FeedbackData): Promise<FeedbackRecord> {
    const [record] = await db('insight_feedback')
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
  static async getFeedbackForInsight(insightId: string, userId: number): Promise<FeedbackRecord[]> {
    return db('insight_feedback')
      .where({
        insight_id: insightId,
        user_id: userId,
      })
      .orderBy('created_at', 'desc');
  }

  /**
   * Get feedback statistics for a user/shop
   */
  static async getFeedbackStats(userId: number, shopId?: number): Promise<{
    total: number;
    byAction: Record<string, number>;
    byTriggerType: Record<string, number>;
  }> {
    const query = db('insight_feedback').where('user_id', userId);
    
    if (shopId) {
      query.andWhere('shop_id', shopId);
    }

    const feedback = await query;

    const byAction = feedback.reduce((acc, item) => {
      acc[item.feedback_action] = (acc[item.feedback_action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const byTriggerType = feedback.reduce((acc, item) => {
      acc[item.trigger_type] = (acc[item.trigger_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: feedback.length,
      byAction,
      byTriggerType,
    };
  }

  /**
   * Check if user has already provided feedback for an insight
   */
  static async hasProvidedFeedback(insightId: string, userId: number): Promise<boolean> {
    const count = await db('insight_feedback')
      .where({
        insight_id: insightId,
        user_id: userId,
      })
      .count('id as count')
      .first();

    return parseInt(count?.count as string) > 0;
  }
}