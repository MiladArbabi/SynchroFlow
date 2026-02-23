// apps/backend/src/services/ft0-completion.service.ts
/**
 * ============================================================
 * FT0 COMPLETION
 * ============================================================
 *
 * FT0 represents *system readiness*, NOT customer success.
 * It answers exactly one question:
 *
 *   “Has the commerce → insight pipeline proven it works end-to-end?”
 *
 * -------------------------
 * FT0 COMPLETES WHEN (ALL):
 * -------------------------
 * 1. A platform integration exists for the shop (e.g. Shopify)
 * 2. At least one  order exists (orders > 0)
 * 3. First insight has been successfully delivered
 *
 * -------------------------
 * EXPLICITLY NOT REQUIRED:
 * -------------------------
 * - Product count
 * - Store visitors / sessions
 * - SDK installation
 * - Traffic volume
 * - Conversion signals
 *
 * These belong to FT1+ and MUST NOT gate FT0.
 *
 * -------------------------
 * GUARANTEES:
 * -------------------------
 * - FT0 completion is idempotent
 * - ft0_state is written exactly once per shop
 * - Completion is authoritative and irreversible
 *
 * -------------------------
 * WARNING:
 * -------------------------
 * Do NOT add new conditions here without updating the
 * activation contract and frontend expectations.
 *
 * Silent FT0 blocking = broken onboarding.
 *
 * ============================================================
 */

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { LifecycleTransitionService } from './lifecycle-transition.service.js';

export class FT0CompletionService {
  static async evaluateAndComplete(
    shopId: number
  ): Promise<{ completed: boolean; alreadyCompleted?: boolean }> {

    // Fast path: already completed
    const existing = await db('ft0_state')
      .where({ shop_id: shopId })
      .first('shop_id');

    if (existing) {
      return { completed: true, alreadyCompleted: true };
    }

    console.log('[FT0Completion] evaluateAndComplete called for shopId:', shopId);

    // 2. Integration must exist
    const integration = await db('integrations')
      .where({ shop_id: shopId })
      .first();

    if (!integration) {
      return { completed: false };
    }

    // 3. Sync must be completed
    const completedSync = await db('integrations')
      .where({ shop_id: shopId, sync_status: 'COMPLETED' })
      .first();

    if (!completedSync) {
      return { completed: false };
    }

    // 4. Orders data must exist
    const ordersRow = await db('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();

    const orderCount = Number(ordersRow?.count ?? 0);

    if (orderCount < 1) {
      return { completed: false };
    }

    /**
     * FIRST INSIGHT DELIVERY (SHOP-SCOPED)
     * -------------------------------------
     * This is a shop-level fact.
     *
     * FT0 represents system readiness of the commerce pipeline,
     * not individual user progression.
     *
     * A shop may have multiple owners/admins.
     * Insight delivery to any qualifying admin promotes the shop state.
     *
     * This flag MUST live on `shops`, never `users`.
     */
    const shop = await db('shops')
      .where({ id: shopId })
      .first('first_insight_delivered');

    if (!shop?.first_insight_delivered) {
      return { completed: false };
    }

    console.log('[FT0Completion] Preconditions passed, writing ft0_state for shopId:', shopId);

    console.log('[FT0][READY_TO_COMPLETE]', {
      shopId,
      orderCount,
    });

    /**
     * Atomic FT0 completion.
     *
     * Guarantees:
     * - ft0_state and audit event are written in the same transaction.
     * - Either both persist or neither persist.
     * - No fallback reads.
     */
    return await db.transaction(async trx => {

      /**
       * SERIALIZATION LOCK
       * ------------------
       * Lock shop row to prevent concurrent FT0 execution.
       */
      await trx('shops')
        .where({ id: shopId })
        .forUpdate()
        .first();

      /**
       * RECHECK FT0 INSIDE LOCK
       * ------------------------
       * Prevent race between concurrent workers.
       */
      const existingFt0 = await trx('ft0_state')
        .where({ shop_id: shopId })
        .first('shop_id');

      if (existingFt0) {
        console.log('[FT0][ALREADY_COMPLETED_LOCKED]', { shopId });
        return { completed: true, alreadyCompleted: true };
      }

      await trx('ft0_state').insert({
        shop_id: shopId,
        status: 'COMPLETED',
        completed_at: trx.fn.now(),
        completion_reason: {
          integration: true,
          syncCompleted: true,
          orders: orderCount,
          firstInsightDelivered: true,
        },
      });

      /**
       * Dual-write: Durable readiness state (v2 backbone)
       *
       * Presence = READY
       * Absence = UNREADY
       *
       * This table replaces ft0_state as authoritative
       * readiness signal for future read-switch.
       */
      await trx('system_readiness_state')
        .insert({
          shop_id: shopId,
          became_ready_at: trx.fn.now(),
        });

      await trx('activation_audit_events')
      .insert({
        event_id: crypto.randomUUID(),
        event_type: 'FT0_COMPLETED',
        shop_id: shopId,
        occurred_at: trx.fn.now(),
        payload: {
          orders: orderCount,
          firstInsightDelivered: true,
        },
      });

      /**
       * LIFECYCLE PROMOTION (ATOMIC WITH DURABILITY)
       * --------------------------------------------
       * FT0 completion is shop-scoped durability.
       * All current shop members must transition:
       *
       *   FT_MINUS_ONE → FT0
       *   FT0 → FT1
       *
       * This guarantees automatic FT1 landing.
       */

      const members = await trx('shop_memberships')
        .where({ shop_id: shopId })
        .select<{ user_id: number }[]>('user_id');

      console.log('[FT0][LIFECYCLE_PROMOTION_START]', {
        shopId,
        memberCount: members.length,
      });

      for (const member of members) {
        const userId = member.user_id;

        console.log('[FT0][PROMOTE_TO_FT0]', { shopId, userId });

        await LifecycleTransitionService.auditIfTransitioned(
          { userId, shopId, currentPhase: 'FT0' },
          trx
        );

        console.log('[FT0][PROMOTE_TO_FT1]', { shopId, userId });

        await LifecycleTransitionService.auditIfTransitioned(
          { userId, shopId, currentPhase: 'FT1' },
          trx
        );
      }

      console.log('[FT0][LIFECYCLE_PROMOTION_COMPLETE]', { shopId });

      console.log('[FT0][COMPLETED]', { shopId });

      return { completed: true };
    });

  }
};