/**
 * FT2 Confirm — WRITE AUTHORITY
 * ----------------------------
 * The ONLY endpoint allowed to promote a user from FT1 → FT2.
 *
 * Guarantees:
 * - Lifecycle is snapshot-driven (read authority)
 * - Promotion is explicit and user-triggered
 * - FT2 eligibility is re-evaluated at time of confirm
 *
 * Forbidden:
 * - Implicit promotion
 * - Entitlement-derived lifecycle
 * - Inference from data readiness
 */

//apps/backend/src/api/lifecycle/lifecycle.controller.ts
import { Request, Response } from 'express';
import { LifecycleService } from '../../services/lifecycle.service.js';
import db from '@lasyncro/backend-core/db.js';
import { FT2EvaluatorService } from '../../services/ft2-evaluator.service.js';
import { LifecycleTransitionService } from '../../services/lifecycle-transition.service.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';

export async function getLifecycle(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;
    const phase = await LifecycleService.resolveForUser(userId);

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

    const { shopId } = await requireShopContextForUser(userId);

    if (!shopId) {
      return res.status(400).json({
        error: 'integration_missing',
      });
    }

    const result = await FT2EvaluatorService.evaluate(shopId);

    return res.json(result);
}

/**
 * FT1 Confirm — WRITE AUTHORITY
 * ----------------------------
 * Explicitly promotes:
 *   FT_MINUS_ONE → FT1
 *
 * Preconditions:
 * - Authenticated user
 * - Integration exists (shop context resolvable)
 *
 * Guarantees:
 * - Snapshot-driven lifecycle
 * - Idempotent
 * - Audited
 *
 * Forbidden:
 * - Inference
 * - Auto-promotion
 * - Entitlement checks
 * - Never allow UI code to infer lifecycle again.
 * 
 * MUST:
 * - Confirm endpoints MUST be idempotent on the target phase.
 */
export async function confirmFt1(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    const { shopId } = await requireShopContextForUser(userId);
    if (!shopId) {
      return res.status(409).json({
        error: 'integration_missing',
      });
    }

    const existing = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: string }>();

    if (existing?.phase === 'FT1' || existing?.phase === 'FT2') {
      return res.status(200).json({ phase: existing.phase });
    }

    /**
     * ATOMIC PROMOTION:
     *
     * FT1 confirmation must NOT fabricate FT0.
     * Readiness (FT0) is durability-driven and handled
     * exclusively by FT0CompletionService.
     *
     * Lifecycle promotion here is explicit and user-triggered.
     */
    await db.transaction(async trx => {
      await LifecycleTransitionService.auditIfTransitioned(
        { userId, shopId, currentPhase: 'FT1' },
        trx
      );
    });

    return res.status(200).json({ phase: 'FT1' });
      } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('Invalid lifecycle transition')
      ) {
        return res.status(409).json({
          error: 'invalid_lifecycle_transition',
          message: err.message,
        });
      }

      console.error('[lifecycle][ft1-confirm] failed', err);
      return res.status(500).json({ error: 'Failed to confirm FT1' });
    }
};

/**
 * FT2 Confirm — WRITE AUTHORITY
 * ----------------------------
 * The ONLY endpoint allowed to promote a user from FT1 → FT2.
 *
 * Guarantees:
 * - Lifecycle is snapshot-driven (read authority)
 * - Promotion is explicit and user-triggered
 * - FT2 eligibility is re-evaluated at time of confirm
 *
 * Forbidden:
 * - Implicit promotion
 * - Entitlement-derived lifecycle
 * - Inference from data readiness
 * - Never allow UI code to infer lifecycle again.
 * 
 * MUST:
 * - Confirm endpoints MUST be idempotent on the target phase.
 */
export async function confirmFt2(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: string; shop_id: number }>();

    if (snapshot?.phase === 'FT2') {
      return res.status(200).json({ phase: 'FT2' });
    }

    if (!snapshot || snapshot.phase !== 'FT1') {
      return res.status(409).json({
        error: 'ft1_not_confirmed',
        phase: snapshot?.phase ?? null,
      });
    }

    const shopId = snapshot.shop_id;

    const evaluation = await FT2EvaluatorService.evaluate(shopId);

    if (!evaluation.eligible) {
      return res.status(409).json({
        error: 'FT2 not eligible',
        blockers: evaluation.blockers,
      });
    }

    /**
     * ATOMIC FT2 PROMOTION:
     * - Write durable FT2 latch
     * - Write lifecycle audit
     * - Update snapshot
     * All must succeed or fail together.
     */
    await db.transaction(async trx => {
      await trx('ft2_state')
        .insert({
          shop_id: shopId,
          completed_at: trx.fn.now(),
          evaluator_version: evaluation.evaluatorVersion,
          evaluation_snapshot: evaluation,
        })
        .onConflict('shop_id')
        .ignore();

      /**
       * Dual-write: Durable FT2 eligibility state (v2 backbone)
       *
       * This table will replace ft2_state during read-switch.
       * Eligibility snapshot persisted verbatim.
       */
      await trx('expansion_eligibility_state')
        .insert({
          shop_id: shopId,
          eligible: true,
          evaluator_version: evaluation.evaluatorVersion,
          evaluation_snapshot: evaluation,
          evaluated_at: trx.fn.now(),
        })
        .onConflict('shop_id')
        .merge({
          eligible: true,
          evaluator_version: evaluation.evaluatorVersion,
          evaluation_snapshot: evaluation,
          evaluated_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });

      await LifecycleTransitionService.auditIfTransitioned(

        { userId, shopId, currentPhase: 'FT2' },
        trx
      );
    });

    return res.status(200).json({ phase: 'FT2' });
    } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Invalid lifecycle transition')
    ) {
      return res.status(409).json({
        error: 'invalid_lifecycle_transition',
        message: err.message,
      });
    }

    console.error('[lifecycle][ft2-confirm] failed', err);
    return res.status(500).json({ error: 'Failed to confirm FT2' });
  }
};