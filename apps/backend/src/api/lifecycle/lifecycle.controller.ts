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
    /**
     * ⚠️ WARNING — DEBUG ONLY ENDPOINT
     *
     * This endpoint exposes full eligibility logic.
     *
     * MUST NOT be used for:
     * - UI readiness
     * - UX gating
     * - lifecycle transitions
     *
     * Use /api/v1/lifecycle/ft2/readiness instead.
     *
     * Violations will reintroduce:
     * - premature FT2 access
     * - double-click bugs
     * - UX inconsistency
     */

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
 * FT2 Readiness — PRODUCTION CONTRACT
 * -----------------------------------
 * Explicit readiness signal for UI.
 *
 * Guarantees:
 * - No lifecycle mutation
 * - No eligibility leakage
 * - Stable contract for UX gating
 *
 * NOTE:
 * This endpoint MUST remain lightweight and deterministic.
 */
export async function getFt2Readiness(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;
    const { shopId } = await requireShopContextForUser(userId);

    if (!shopId) {
      return res.status(400).json({ error: 'integration_missing' });
    }

    /**
     * SOURCE OF TRUTH — system_readiness_state
     *
     * Presence = ready
     * Absence = not ready
     */
    const readiness = await db('system_readiness_state')
      .where({ shop_id: shopId })
      .first();

    /**
     * Observability — readiness signal
     *
     * Allows tracing readiness decisions in logs.
     */
    console.info('[FT2_READINESS_CHECK]', {
      shopId,
      ready: !!readiness,
      source: 'system_readiness_state',
    });

    /**
     * PROGRESS SIGNAL (v0)
     * -------------------
     * Currently minimal.
     * Future: bind to projection cursor / ingestion metrics.
     */
    return res.json({
      ready: !!readiness,
      progress: {
        currentCursor: null,
        targetCursor: null,
      },

      /**
       * DEBUG SIGNAL (safe for frontend)
       * --------------------------------
       * Helps diagnose readiness issues without extra calls.
       */
      meta: {
        source: 'system_readiness_state',
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[lifecycle][ft2-readiness] failed', err);
    return res.status(500).json({ error: 'Failed to resolve readiness' });
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

/**
 * ARCHITECTURAL NOTE (EVENT-DRIVEN LIFECYCLE)
 * --------------------------------------------
 * FT2 confirmation emits a domain event.
 * No lifecycle tables are mutated here.
 *
 * All state transitions must occur inside projection worker.
 *
 * This guarantees:
 * - Deterministic rebuild
 * - Replay purity
 * - No controller-driven lifecycle mutation
 */
export async function confirmFt2(req: Request, res: Response) {
  try {
    if (!req.user || req.user.userId == null) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.user.userId;

    const shopContext = await requireShopContextForUser(userId);

    const snapshot = await db('user_lifecycle_snapshot')
      .where({ shop_id: shopContext.shopId })
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
     * DOMAIN EVENT EMISSION — FT2 CONFIRMED
     * --------------------------------------
     * Controller no longer mutates lifecycle state directly.
     * It emits an immutable domain event.
     *
     * Projection layer is responsible for:
     * - Writing ft2_state
     * - Writing expansion_eligibility_state
     * - Updating lifecycle snapshot
     *
     * This preserves replay determinism.
     */
    await db.transaction(async trx => {

      const externalEventId = `internal:lifecycle/ft2_confirmed:${shopId}`;

      const [event] = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'lifecycle/ft2_confirmed',
          event_payload: {
            user_id: userId,
            evaluator_version: evaluation.evaluatorVersion,
            evaluation_snapshot: evaluation,
          },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .returning(['id']);

      console.info('[OUTBOX_TRIGGER_EXPECTED]', {
        domainEventId: event.id,
        eventType: 'lifecycle/ft2_confirmed',
      });

      /**
       * OUTBOX HANDLED BY DB TRIGGER
       * ----------------------------
       * domain_event_auto_outbox AFTER INSERT trigger
       * guarantees exactly one outbox row.
       *
       * Manual inserts are forbidden and cause
       * domain_event_outbox_domain_event_unique violations.
       */

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