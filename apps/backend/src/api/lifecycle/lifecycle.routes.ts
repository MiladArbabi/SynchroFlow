//apps/backend/src/api/lifecycle/lifecycle.routes.ts
import { Express } from 'express';
import { getLifecycle, confirmFt2, evaluateFt2 } from './lifecycle.controller.js';
import { getLifecycleHistory } from './lifecycle-history.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

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