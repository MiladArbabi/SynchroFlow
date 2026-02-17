// apps/backend/src/middleware/requireAuth.ts
import { Request } from 'express';

const AUTH_EXEMPT_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh_token',
];

export function requireAuth(req: Request) {
  // 🔓 Explicitly exempt auth recovery routes
  if (AUTH_EXEMPT_PATHS.includes(req.path)) {
    return null;
  }

  if (!req.user || typeof req.user.userId !== 'number') {
    throw new Error('AUTH_INVARIANT_VIOLATION: req.user.userId missing');
  }

  return req.user;
}
