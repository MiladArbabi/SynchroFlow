import request from 'supertest';
import express from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import feedbackRouter from 'api-src/routes/feedback';

// 🔴 Mock auth to inject canonical identity ONLY
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 1 }; // canonical shape
    next();
  },
}));

jest.mock('api-src/db', () => {
  return () => ({
    insert: () => ({
      returning: async () => [{
        id: 1,
        insight_id: 'insight-2',
        feedback_action: 'accepted',
        created_at: new Date(),
      }],
    }),
  });
});

describe('Auth identity contract – identity drift detection', () => {
    it('accepts request when feedback routes use canonical req.user.userId', async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/v1/feedback', (req, res, next) =>
        feedbackRouter(req as any, res as any, next)
      );

      const res = await request(app)
        .post('/api/v1/feedback')
        .send({
          insightId: 'insight-2',
          triggerType: 'coach',
          action: 'accepted',
        });

      /**
       * This SHOULD succeed once legacy identity access is removed
       * and canonical identity is used correctly.
       */
      expect(res.status).toBe(201);
    });
});
