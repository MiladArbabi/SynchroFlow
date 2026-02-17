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

export class FT0CompletionService {
  static async evaluateAndComplete(
    shopId: number
  ): Promise<{ completed: boolean; alreadyCompleted?: boolean }> {

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

    // 6. Complete FT0 (single authoritative write)
    try {
      const inserted = await db('ft0_state')
      .insert({
        shop_id: shopId,
        status: 'COMPLETED',
        completed_at: db.fn.now(),
        completion_reason: {
          integration: true,
          syncCompleted: true,
          orders: orderCount,
          firstInsightDelivered: true,
        },
      })
      .onConflict('shop_id')
      .ignore()
      .returning('shop_id');

    // If nothing was inserted, FT0 already existed
    if (inserted.length === 0) {
      return { completed: true, alreadyCompleted: true };
    }

    // 🔔 FT0 COMPLETION AUDIT EVENT (emitted exactly once)
    await db('activation_audit_events').insert({
      event_id: crypto.randomUUID(),
      event_type: 'FT0_COMPLETED',
      shop_id: shopId,
      occurred_at: db.fn.now(),
      payload: {
        orders: orderCount,
        firstInsightDelivered: true,
      },
    });

    return { completed: true };
    } catch (err) {
      // Defensive fallback (should never happen after uniqueness)
      const existing = await db('ft0_state')
        .where({ shop_id: shopId })
        .first();

      if (existing?.status === 'COMPLETED') {
        return { completed: true, alreadyCompleted: true };
      }

      throw err;
    }
  }
}
