// apps/backend/src/services/ft0-completion.service.ts
import db from 'api-db';
import crypto from 'crypto';

export class FT0CompletionService {
  static async evaluateAndComplete(
    shopId: number
  ): Promise<{ completed: boolean; alreadyCompleted?: boolean }> {

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

    // 4. Canonical data must exist
    const ordersRow = await db('canonical_orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();

        const productsRow = await db('canonical_products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();


    const orderCount = Number(ordersRow?.count ?? 0);
    const productCount = Number(productsRow?.count ?? 0);

    if (orderCount < 1 || productCount < 1) {
      return { completed: false };
    }

    // 5. First insight must be delivered (commit latch)
    const user = await db('users')
      .where({ shop_id: shopId })
      .first('first_insight_delivered');

    if (!user?.first_insight_delivered) {
      return { completed: false };
    }

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
          products: productCount,
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
        products: productCount,
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
