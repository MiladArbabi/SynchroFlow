// apps/backend/src/services/ft2-latch.service.ts

import db from 'api-src/db';
import { FT2EvaluatorService } from './ft2-evaluator.service';

/**
 * FT2 Latch Service
 * -----------------
 * Authoritative, idempotent latch writer for FT2.
 *
 * HARD RULES:
 * - Safe to call repeatedly
 * - No lifecycle resolution
 * - No UI concerns
 * - Write-once semantics
 * - Evaluator snapshot persisted verbatim
 */
export class FT2LatchService {
  static async evaluateAndLatch(
    shopId: number
  ): Promise<{
    latched: boolean;
    eligible: boolean;
    reason?: string;
  }> {
    // 1. Already latched? → no-op
    const existing = await db('ft2_state')
      .where({ shop_id: shopId })
      .first();

    if (existing) {
      console.debug('[FT2_LATCH_SKIPPED]', {
        shopId,
        reason: 'already_latched',
        ts: new Date().toISOString(),
      });

      return {
        latched: false,
        eligible: true,
        reason: 'already_latched',
      };
    }

    // 2. Evaluate eligibility (read-only)
    const evaluation = await FT2EvaluatorService.evaluate(shopId);

    if (!evaluation.eligible) {
      console.debug('[FT2_LATCH_SKIPPED]', {
        shopId,
        reason: 'not_eligible',
        blockers: evaluation.blockers,
        ts: new Date().toISOString(),
      });

      return {
        latched: false,
        eligible: false,
        reason: 'not_eligible',
      };
    }

    // 3. Attempt latch write (idempotent)
    await db('ft2_state')
      .insert({
        shop_id: shopId,
        completed_at: db.fn.now(),
        evaluator_version: evaluation.evaluatorVersion,
        evaluation_snapshot: evaluation,
      })
      .onConflict('shop_id')
      .ignore();

    console.debug('[FT2_LATCH_WRITTEN]', {
      shopId,
      evaluatorVersion: evaluation.evaluatorVersion,
      ts: new Date().toISOString(),
    });

    return {
      latched: true,
      eligible: true,
    };
  }
}