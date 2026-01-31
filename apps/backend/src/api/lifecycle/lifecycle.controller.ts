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
import { LifecycleService } from '../../services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import db from 'api-src/db';
import { requireShopContextForUser } from 'api-src/services/shop-resolution.service';

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

    // Resolve shop context (authoritative)
    const { shopId } = await requireShopContextForUser(userId);
    if (!shopId) {
      return res.status(409).json({
        error: 'integration_missing',
      });
    }

    // Idempotency: snapshot may already exist
    const existing = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: string }>();

    if (existing?.phase === 'FT1' || existing?.phase === 'FT2') {
      /* console.info('[LIFECYCLE][FT1_CONFIRM][IDEMPOTENT]', {
        userId,
        shopId,
        phase: existing.phase,
      }); */
      return res.status(200).json({ phase: existing.phase });
    }

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT0',
    });

    // Write FT1 snapshot explicitly
    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT1',
    });

    /* console.info('[LIFECYCLE][FT1_CONFIRM][PROMOTED]', {
      userId,
      shopId,
    }); */

    return res.status(200).json({ phase: 'FT1' });
  } catch (err) {
    console.error('[lifecycle][ft1-confirm] failed', err);
    return res.status(500).json({ error: 'Failed to confirm FT1' });
  }
}

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

    // 1. Snapshot read — lifecycle authority
    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: string; shop_id: number }>();

    console.info('[LIFECYCLE][CONFIRM][FT2][ATTEMPT]', {
      userId,
    });

    // Idempotency: already FT2
    if (snapshot?.phase === 'FT2') {
      console.info('[LIFECYCLE][CONFIRM][FT2][IDEMPOTENT]', { userId });
      return res.status(200).json({ phase: 'FT2' });
    }

    // Strict precondition: must be FT1
    if (!snapshot || snapshot.phase !== 'FT1') {
      console.info('[LIFECYCLE][CONFIRM][FT2][REJECTED]', {
        userId,
        phase: snapshot?.phase ?? 'NONE',
      });

      return res.status(409).json({
        error: 'ft1_not_confirmed',
        phase: snapshot?.phase ?? null,
      });
    }

    const shopId = snapshot.shop_id;

    // 1. Re-evaluate FT2 eligibility
    const evaluation = await FT2EvaluatorService.evaluate(shopId);

    if (!evaluation.eligible) {
      return res.status(409).json({
        error: 'FT2 not eligible',
        blockers: evaluation.blockers,
      });
    }

    // intentionally omitted — audit service resolves prior phase
    // 2. Capture previous lifecycle phase BEFORE FT2
    /* const previousPhase = await LifecycleService.resolveForUser(userId); */

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

    console.info('[LIFECYCLE][FT2_CONFIRM][LATCH_WRITTEN]', {
      userId,
      shopId,
    });

    // 3. Audit FT1 → FT2 explicitly
    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT2',
    });

    console.info('[LIFECYCLE][FT2_CONFIRM][PROMOTED]', {
      userId,
      shopId,
    });

    // 4. Deterministic command response
    return res.status(200).json({ phase: 'FT2' });
  } catch (err) {
    console.error('[lifecycle][ft2-confirm] failed', err);
    return res.status(500).json({ error: 'Failed to confirm FT2' });
  }
}