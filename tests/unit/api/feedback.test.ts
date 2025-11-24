// packages/api/tests/feedback.test.ts
import request from 'supertest';
import express from 'express';
import feedbackRoutes from 'api-src/routes/feedback'
import db from 'api-src/db';

const app = express();
app.use(express.json());
app.use('/api/v1/feedback', feedbackRoutes);

// Mock auth middleware
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 1, shop_id: 1 };
    next();
  },
}));

describe.skip('Feedback API', () => {
  beforeEach(async () => {
    await db('insight_feedback').del();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('POST /api/v1/feedback', () => {
    it('should record feedback successfully', async () => {
      const feedbackData = {
        insightId: 'test-insight-123',
        triggerType: 'coach',
        action: 'accepted',
      };

      const response = await request(app)
        .post('/api/v1/feedback')
        .send(feedbackData)
        .expect(201);

      expect(response.body.message).toBe('Feedback recorded successfully');
      expect(response.body.feedback.insightId).toBe('test-insight-123');
      expect(response.body.feedback.action).toBe('accepted');

      // Verify record in database
      const records = await db('insight_feedback').where({
        insight_id: 'test-insight-123',
      });
      expect(records).toHaveLength(1);
      expect(records[0].feedback_action).toBe('accepted');
    });

    it('should record feedback with reason and context', async () => {
      const feedbackData = {
        insightId: 'test-insight-456',
        triggerType: 'action',
        action: 'dismissed',
        feedback: {
          reason: 'not_relevant',
          context: 'This doesnt apply to my business model',
        },
      };

      const response = await request(app)
        .post('/api/v1/feedback')
        .send(feedbackData)
        .expect(201);

      expect(response.body.feedback.action).toBe('dismissed');

      const records = await db('insight_feedback').where({
        insight_id: 'test-insight-456',
      });
      expect(records[0].feedback_reason).toBe('not_relevant');
      expect(records[0].feedback_context).toBe('This doesnt apply to my business model');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/feedback')
        .send({}) // Empty payload
        .expect(400);

      expect(response.body.error).toBe('Invalid feedback data');
    });

    it('should validate trigger type enum', async () => {
      const response = await request(app)
        .post('/api/v1/feedback')
        .send({
          insightId: 'test-123',
          triggerType: 'invalid-type',
          action: 'accepted',
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid feedback data');
    });
  });

  describe('GET /api/v1/feedback/insights/:insightId', () => {
    it('should retrieve feedback for an insight', async () => {
      // Insert test data
      await db('insight_feedback').insert({
        insight_id: 'test-insight-789',
        trigger_type: 'coach',
        feedback_action: 'accepted',
        user_id: 1,
        shop_id: 1,
      });

      const response = await request(app)
        .get('/api/v1/feedback/insights/test-insight-789')
        .expect(200);

      expect(response.body.feedback).toHaveLength(1);
      expect(response.body.feedback[0].insight_id).toBe('test-insight-789');
      expect(response.body.feedback[0].feedback_action).toBe('accepted');
    });

    it('should return empty array for non-existent insight', async () => {
      const response = await request(app)
        .get('/api/v1/feedback/insights/non-existent')
        .expect(200);

      expect(response.body.feedback).toHaveLength(0);
    });
  });
});