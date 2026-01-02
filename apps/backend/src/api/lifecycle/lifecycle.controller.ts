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

/**
 * FT2 Confirm Promotion
 * ---------------------
 * Explicit user-triggered promotion from FT1 → FT2.
 * This is the ONLY place allowed to write ft2_state.
 */
export async function confirmFt2(req: Request, res: Response) {
  try {
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
      return res.status(400).json({ error: 'No shop associated with user' });
    }

    // 1. Re-evaluate FT2 eligibility
    const evaluation = await FT2EvaluatorService.evaluate(shopId);

    if (!evaluation.eligible) {
      return res.status(409).json({
        error: 'FT2 not eligible',
        blockers: evaluation.blockers,
      });
    }

    // 2. Write FT2 latch (idempotent)
    await db('ft2_state')
      .insert({
        shop_id: shopId,
        completed_at: db.fn.now(),
        evaluator_version: evaluation.evaluatorVersion,
        evaluation_snapshot: evaluation,
      })
      .onConflict('shop_id')
      .ignore();

    // 3. Resolve lifecycle  audit transition
    const phase = await LifecycleService.resolveForUser(userId);

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: phase,
    });

    return res.status(200).json({ phase });
  } catch (err) {
    console.error('[lifecycle][ft2-confirm] failed', err);
    return res.status(500).json({ error: 'Failed to confirm FT2' });
  }
}
