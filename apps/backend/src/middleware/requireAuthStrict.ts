//apps/backend/src/middleware/requireAuthStrict.ts
import { Request } from 'express';
import { requireAuth } from './requireAuth';

export function requireAuthStrict(req: Request) {
  const ctx = requireAuth(req);

  if (!ctx) {
    throw new Error('AUTH_REQUIRED');
  }

  return ctx;
}