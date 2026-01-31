//apps/backend/src/api/lifecycle/lifecycle-history.controller.ts
import { Request, Response } from 'express';
import { LifecycleHistoryService } from 'api-src/services/lifecycle-history.service';

export async function getLifecycleHistory(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    const history = await LifecycleHistoryService.getForUser(userId);

    return res.status(200).json(history);
  } catch (err) {
/*     console.error('[lifecycle-history] failed', err);
 */    return res.status(500).json({ error: 'Failed to load lifecycle history' });
  }
}