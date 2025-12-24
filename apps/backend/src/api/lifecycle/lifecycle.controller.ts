//apps/backend/src/api/lifecycle/lifecycle.controller.ts
import { Request, Response } from 'express';
import { LifecycleService } from '../../services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';

export async function getLifecycle(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    const phase = await LifecycleService.resolveForUser(userId);

    const shopId = (req.user as any).shop_id;

    if (shopId) {
      await LifecycleTransitionService.auditIfTransitioned({
        userId,
        shopId,
        currentPhase: phase,
      });
    }

    return res.status(200).json({ phase });
  } catch (err) {
    console.error('[lifecycle] failed to resolve lifecycle', err);
    return res.status(500).json({ error: 'Failed to resolve lifecycle' });
  }
}
