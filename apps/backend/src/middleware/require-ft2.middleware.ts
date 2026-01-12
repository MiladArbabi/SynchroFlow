// apps/backend/src/middleware/require-ft2.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { LifecycleService } from 'api-src/services/lifecycle.service';

export async function requireFt2(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phase = await LifecycleService.resolveForUser(req.user.userId);

  if (phase !== 'FT2') {
    return res.status(403).json({
      error: 'FT2 access requires confirmed FT2 lifecycle',
      phase,
    });
  }

  next();
}