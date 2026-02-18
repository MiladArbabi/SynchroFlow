// apps/backend/src/services/lifecycle-projection.service.ts

/**
 * ============================================================
 * LifecycleProjectionService
 * ============================================================
 *
 * Projects shop durability state into a newly added user.
 *
 * Triggered immediately after:
 *   INSERT INTO shop_memberships
 *
 * HARD RULES:
 * - Must run inside existing transaction.
 * - Must NOT infer lifecycle.
 * - Must NOT write snapshot directly.
 * - Must ONLY use LifecycleTransitionService.
 * - Must respect sequential transitions.
 * - Must be idempotent and replay-safe.
 *
 * ============================================================
 */

import type { Knex } from 'knex';
import { LifecycleTransitionService } from './lifecycle-transition.service.js';

export class LifecycleProjectionService {

  static async projectForMembership(
    params: { shopId: number; userId: number },
    trx: Knex.Transaction
  ): Promise<void> {

    const { shopId, userId } = params;

    if (!trx) {
      throw new Error(
        'LIFECYCLE_PROJECTION_REQUIRES_TRANSACTION'
      );
    }

    console.debug('[LIFECYCLE_PROJECTION][START]', {
      shopId,
      userId,
    });

    // ------------------------------------------------------------
    // Step 1 — Read shop durability state
    // ------------------------------------------------------------

    const readiness = await trx('system_readiness_state')
      .where({ shop_id: shopId })
      .first();

    const ft2 = await trx('ft2_state')
      .where({ shop_id: shopId })
      .first();

    const shopLevel =
      ft2 ? 'FT2'
      : readiness ? 'FT1'
      : 'FT_MINUS_ONE';

    console.debug('[LIFECYCLE_PROJECTION][SHOP_STATE]', {
      shopId,
      shopLevel,
    });

    // ------------------------------------------------------------
    // Step 2 — Execute sequential transitions
    // ------------------------------------------------------------

    if (shopLevel === 'FT_MINUS_ONE') {
      console.debug('[LIFECYCLE_PROJECTION][NO_ACTION]', {
        shopId,
        userId,
      });
      return;
    }

    // Always project FT0 first if readiness exists
    await LifecycleTransitionService.auditIfTransitioned(
      { userId, shopId, currentPhase: 'FT0' },
      trx
    );

    await LifecycleTransitionService.auditIfTransitioned(
      { userId, shopId, currentPhase: 'FT1' },
      trx
    );

    if (shopLevel === 'FT2') {
      await LifecycleTransitionService.auditIfTransitioned(
        { userId, shopId, currentPhase: 'FT2' },
        trx
      );
    }

    console.debug('[LIFECYCLE_PROJECTION][COMPLETE]', {
      shopId,
      userId,
      projectedTo: shopLevel,
    });
  }
}