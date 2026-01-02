//apps/backend/src/api/lifecycle/lifecycle.controller.ts
import { Request, Response } from 'express';
import { LifecycleService } from '../../services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import db from 'api-src/db';

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


/**
   * DEBUG ONLY — FT2 Readiness Evaluation
   * -----------------------------------
   * READ-ONLY endpoint for manual FT2 inspection.
   * Must NOT write ft2_state or affect lifecycle.
   */
  export async function evaluateFt2(req, res) {
      if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  
    const userId = req.user.userId;

    const user = await db('users')
      .where({ id: userId })
      .select('shop_id')
      .first();

    const shopId = user?.shop_id;

    if (!shopId) {
      return res.status(400).json({
        error: 'No shop associated with user',
      });
    }

    const result = await FT2EvaluatorService.evaluate(shopId);

    return res.json(result);
}
