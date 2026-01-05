import { Request } from 'express';

export function requireAuth(req: Request) {
  if (!req.user || typeof req.user.userId !== 'number') {
    throw new Error('AUTH_INVARIANT_VIOLATION: req.user.userId missing');
  }

  return req.user;
}
