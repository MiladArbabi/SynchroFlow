// apps/backend/src/services/first-insight.service.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

type OrdersPerMonthSegment =
  | '1-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1000+';

export class FirstInsightService {
  /**
   * Computes and persists the FIRST insight for a shop.
   * This is the ONLY place allowed to set first_insight_delivered = true.
   */
  static async computeAndPersist(shopId: number): Promise<{
    delivered: boolean;
    alreadyDelivered?: boolean;
  }> {
    // 1. Guard: shop must exist
    const shop = await db('shops')
      .where({ id: shopId })
      .first([
        'id',
        'first_insight_delivered',
      ]);

    if (!shop) {
      return { delivered: false };
    }

    // 2. Idempotency: already delivered → exit
    if (shop.first_insight_delivered) {
      return { delivered: true, alreadyDelivered: true };
    }

    // 3. Compute monthly order volume (FACT: orders exists)
    const result = await db('orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('* as count')
      .first();

    const orderCount = Number(result?.count ?? 0);

    if (orderCount < 1) {
      // No insight possible yet
      return { delivered: false };
    }

    // 4. Derive segment (pure, deterministic)
    const segment: OrdersPerMonthSegment =
      orderCount <= 50
        ? '1-50'
        : orderCount <= 200
        ? '51-200'
        : orderCount <= 500
        ? '201-500'
        : orderCount <= 1000
        ? '501-1000'
        : '1000+';

    // 5. Atomic persist + audit
    await db.transaction(async trx => {
      await trx('shops')
        .where({ id: shopId })
        .update({
          first_insight_delivered: true,
          updated_at: trx.fn.now(),
        });

      await trx('activation_audit_events').insert({
        event_id: crypto.randomUUID(),
        event_type: 'FIRST_INSIGHT_DELIVERED',
        shop_id: shopId,
        occurred_at: trx.fn.now(),
        payload: {
          insight: 'orders_per_month_segment',
          value: segment,
          orderCount,
        },
      });
    });

    return { delivered: true };
  }
}