import { Express } from 'express';
import { authenticateToken } from 'api-src/middleware/auth.middleware';
import { getActivationVerdict } from './activation.controller';

export function registerActivationRoutes(app: Express) {
  app.get(
    '/api/v1/activation/verdict',
    authenticateToken,
    getActivationVerdict
  );
}
