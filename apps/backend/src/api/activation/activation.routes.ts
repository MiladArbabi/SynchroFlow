import { Express } from 'express';
import { getActivationVerdict } from './activation.controller.js';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';

export function registerActivationRoutes(app: Express) {
  app.get(
    '/api/v1/activation/verdict',
    authenticateToken,
    getActivationVerdict
  );
}
