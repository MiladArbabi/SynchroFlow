// apps/backend/src/services/ft0-completion.service.ts
import db from 'api-db';

export class FT0CompletionService {
  static async evaluateAndComplete(
    shopId: number
  ): Promise<{ completed: boolean; alreadyCompleted?: boolean }> {

    // 1. Check existing FT0 state (idempotency)
    const existing = await db('ft0_state')
      .where({ shop_id: shopId })
      .first();

    if (existing?.status === 'COMPLETED') {
      return { completed: true, alreadyCompleted: true };
    }

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
    await db('ft0_state').insert({
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
    });

    return { completed: true };
  }
}
