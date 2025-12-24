//apps/backend/src/api/lifecycle/lifecycle.routes.ts
import { Express } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { getLifecycle } from './lifecycle.controller';
import { getLifecycleHistory } from './lifecycle-history.controller';

export function registerLifecycleRoutes(app: Express) {
  app.get('/api/v1/lifecycle', authenticateToken, getLifecycle);
  app.get('/api/v1/lifecycle/history', authenticateToken, getLifecycleHistory);
};