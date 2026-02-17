// apps/backend/src/api/activation/__tests__/createActivationTestApp.ts

import express, { Express } from 'express';
import { registerActivationRoutes } from '../activation.routes.js';

// Hard mock auth for activation tests only
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 1 };
    next();
  },
}));

export function createActivationTestApp(): Express {
  const app = express();

  app.use(express.json());

  // Only activation routes — nothing else
  registerActivationRoutes(app);

  return app;
}
