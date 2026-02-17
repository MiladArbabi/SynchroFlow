//apps/backend/src/api/lifecycle/__tests__/createLifecycleTestApp.ts
import express from 'express';
import { registerLifecycleRoutes } from '../lifecycle.routes.js';

export function createLifecycleTestApp() {
  const app = express();
  app.use(express.json());

  // Fake auth middleware
  app.use((req: any, _res, next) => {
    req.user = { userId: 1 };
    next();
  });

  registerLifecycleRoutes(app);
  return app;
}
