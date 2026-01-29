// apps/backend/src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.ts

import db from 'api-src/db';

/**
 * Canonical Fulfillment Ingestion Service
 * --------------------------------------
 * The ONLY authorized writer to `order_fulfillment_status`.
 *
 * Contract:
 * - Idempotent
 * - Deterministic
 * - Fail-closed
 *
 * Canonical Rule (HARD):
 * - canonical_order_id MUST be present
 * - Execution truth without canonical identity is forbidden
 *
 * This service assumes canonical resolution has already succeeded.
 * If canonical_order_id is missing, this is a caller bug.
 *
 * This service exists to enable:
 * - revenue allocation by execution state
 * - operational / economic joins
 * - FT2-safe downstream reasoning
 */
export class OrderFulfillmentIngestionService {
  async ingestStatus(input: {
    shopId: number;
    platformOrderId: string;
    canonicalOrderId: string;
    status: 'processing' | 'in_transit' | 'delivered' | 'cancelled';
  }): Promise<void> {
    const { shopId, platformOrderId, canonicalOrderId, status } = input;

    if (!canonicalOrderId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] canonical_order_id is required. ' +
        'Execution truth must not be written without canonical identity.'
      );
    }

    await db('order_fulfillment_status')
      .insert({
        shop_id: shopId,
        order_id: platformOrderId,

        /**
         * Canonical linkage
         * -----------------
         * Enables deterministic joins.
         * Nullable by design (fail-closed).
         */
        canonical_order_id: canonicalOrderId,

        status,
        status_updated_at: db.fn.now(),
      })
      .onConflict(['shop_id', 'order_id'])
      .merge({
        status,
        canonical_order_id: canonicalOrderId,
        status_updated_at: db.fn.now(),
      });
  }
}

export default new OrderFulfillmentIngestionService();