// apps/backend/src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.ts

import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';

/**
 * Sovereign Fulfillment Ingestion Service
 * ---------------------------------------
 * - Identity: lasyncro_order_id
 * - Writes factual execution state only
 * - Idempotent on lasyncro_order_id
 */

export class OrderFulfillmentIngestionService {

  /**
   * Ingest sovereign fulfillment state.
   *
   * @param executor Optional DB executor (transaction-safe).
   *                 Defaults to global db instance.
   */
  async ingestStatus(
    input: {
      lasyncroOrderId: string;
      status:
        | 'pending'
        | 'processing'
        | 'fulfilled'
        | 'partially_fulfilled'
        | 'cancelled'
        | 'failed';
    },
    executor: Knex | Knex.Transaction = db
  ): Promise<void> {

    const { lasyncroOrderId, status } = input;

    if (!lasyncroOrderId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] lasyncro_order_id is required.'
      );
    }

    await executor('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        status_updated_at: executor.fn.now(),
      })
      .onConflict(['lasyncro_order_id'])
      .merge({
        status,
        status_updated_at: executor.fn.now(),
      });
  }
}

export default new OrderFulfillmentIngestionService();