// apps/backend/src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.ts

import db from 'api-src/db';

/**
 * Sovereign Fulfillment Ingestion Service
 * ---------------------------------------
 * - Identity: lasyncro_order_id
 * - Writes factual execution state only
 * - Idempotent on lasyncro_order_id
 */

export class OrderFulfillmentIngestionService {

  async ingestStatus(input: {
    lasyncroOrderId: string;
    status: 'processing' | 'in_transit' | 'delivered' | 'cancelled';
  }): Promise<void> {

    const { lasyncroOrderId, status } = input;

    if (!lasyncroOrderId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] lasyncro_order_id is required.'
      );
    }

    await db('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        status_updated_at: db.fn.now(),
      })
      .onConflict(['lasyncro_order_id'])
      .merge({
        status,
        status_updated_at: db.fn.now(),
      });
  }
}

export default new OrderFulfillmentIngestionService();