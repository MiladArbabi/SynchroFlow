//apps/backend/src/api/lifecycle/lifecycle.routes.ts
import { Express } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { getLifecycle, confirmFt2, confirmFt1, confirmFt0, evaluateFt2 } from './lifecycle.controller';
import { getLifecycleHistory } from './lifecycle-history.controller';

export function registerLifecycleRoutes(app: Express) {
  app.get('/api/v1/lifecycle', authenticateToken, getLifecycle);
  app.get('/api/v1/lifecycle/history', authenticateToken, getLifecycleHistory);

  /**
   * FT0 Explicit Initialization (user-confirmed)
   */
  app.post('/api/v1/lifecycle/ft0/confirm', authenticateToken, confirmFt0);

  /**
   * FT1 Explicit Promotion (user-confirmed)
   */
  app.post('/api/v1/lifecycle/ft1/confirm', authenticateToken, confirmFt1);

  /**
   * DEBUG ONLY — FT2 Readiness Evaluation (READ-ONLY)
   */
   app.get('/api/v1/lifecycle/ft2/evaluate', authenticateToken, evaluateFt2);

  /**
   * FT2 Explicit Promotion (user-confirmed)
   */
   app.post('/api/v1/lifecycle/ft2/confirm', authenticateToken, confirmFt2);
};