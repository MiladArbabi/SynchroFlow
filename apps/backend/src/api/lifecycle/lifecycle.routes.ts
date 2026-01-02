//apps/backend/src/api/lifecycle/lifecycle.routes.ts
import { Express } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { getLifecycle, confirmFt2 } from './lifecycle.controller';
import { getLifecycleHistory } from './lifecycle-history.controller';
import { evaluateFt2 } from './lifecycle.controller';

export function registerLifecycleRoutes(app: Express) {
  app.get('/api/v1/lifecycle', authenticateToken, getLifecycle);
  app.get('/api/v1/lifecycle/history', authenticateToken, getLifecycleHistory);

  /**
   * DEBUG ONLY — FT2 Readiness Evaluation (READ-ONLY)
   */
   app.get('/api/v1/lifecycle/ft2/evaluate', authenticateToken, evaluateFt2);

  /**
   * FT2 Explicit Promotion (user-confirmed)
   */
   app.post('/api/v1/lifecycle/ft2/confirm', authenticateToken, confirmFt2);
};