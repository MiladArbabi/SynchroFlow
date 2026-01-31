// apps/backend/src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.ts

import db from 'api-src/db';

type SyntheticExecutionInput = {
  shopId: number;
  canonicalOrderId: string;
  platformOrderId: string;
};

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
        canonical_order_id: canonicalOrderId,

        status,
        status_updated_at: db.fn.now(),

        /**
         * Execution provenance
         * --------------------
         * This service only writes OBSERVED execution.
         * Synthetic execution is written by reconciliation workers.
         */
        execution_source: 'observed',
        execution_confidence: 'certain',
      })
      .onConflict(['shop_id', 'order_id'])
      .merge({
        status,
        canonical_order_id: canonicalOrderId,
        status_updated_at: db.fn.now(),

        // Observed execution always overrides synthetic
        execution_source: 'observed',
        execution_confidence: 'certain',
      });
  }

  /**
   * Synthesize execution for canonical orders
   * -----------------------------------------
   * Used by reconciliation workers ONLY.
   *
   * Rules:
   * - Never overwrite observed execution
   * - Synthetic execution uses valid platform states
   * - Presence beats absence
   */
  async synthesizeExecution(input: SyntheticExecutionInput): Promise<void> {
    const { shopId, canonicalOrderId, platformOrderId } = input;

    await db('order_fulfillment_status')
      .insert({
        shop_id: shopId,
        order_id: platformOrderId,
        canonical_order_id: canonicalOrderId,

        // Valid platform state (never invent)
        status: 'processing',
        status_updated_at: db.fn.now(),

        execution_source: 'synthetic',
        execution_confidence: 'assumed',
      })
      .onConflict(['shop_id', 'order_id'])
      .ignore(); // observed execution always wins
  }
};

export default new OrderFulfillmentIngestionService();