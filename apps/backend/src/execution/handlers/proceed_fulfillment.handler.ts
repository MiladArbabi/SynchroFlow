/**
 * proceed_fulfillment HANDLER
 * ---------------------------
 * Executes fulfillment progression.
 *
 * CURRENT:
 * - Placeholder (no side-effects yet)
 *
 * PURPOSE:
 * - Unblock execution pipeline
 * - Provide deterministic execution surface
 *
 * TODO:
 * - Integrate with fulfillment service
 */
import db from '@lasyncro/backend-core/db.js';
import { ExecutionHandler } from '../execution.registry.js';

export const proceedFulfillmentHandler: ExecutionHandler = async (job) => {
  console.info('[HANDLER_EXECUTION_START]', {
    action: 'proceed_fulfillment',
    decision_id: job.decision_id,
    entity_id: job.entity_id
  });

    /**
     * IDEMPOTENCY GUARD (CRITICAL)
     * -----------------------------
     * Prevents duplicate external side-effects.
     *
     * Strategy:
     * - decision_id is unique key
     * - if exists → skip execution
     */
    const existing = await db('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .first();

    if (existing) {
      console.warn('[FULFILLMENT_ALREADY_EXECUTED]', {
        decision_id: job.decision_id
      });
      return;
    }

  /**
   * EXECUTION RECORD (PENDING)
   * --------------------------
   * Created BEFORE external call.
   * Ensures visibility even if process crashes.
   */
  await db('fulfillment_executions').insert({
    id: crypto.randomUUID(),
    decision_id: job.decision_id,
    lasyncro_order_id: job.entity_id,
    external_order_id: 'UNKNOWN', // resolved later
    shop_id: job.shop_id,
    status: 'pending'
  });

    /**
   * STEP 1 — RESOLVE ORDER IDENTITY (MANDATORY)
   * -------------------------------------------
   * Required to map internal → external order
   */
  if (!job.entity_id) {
    throw new Error('[FULFILLMENT_MISSING_ENTITY_ID]');
  }

  /**
   * STEP 2 — RESOLVE SHOP CONTEXT (MANDATORY)
   * -----------------------------------------
   * Required for Shopify API access + RLS context
   */
  if (!job.shop_id) {
    throw new Error('[FULFILLMENT_MISSING_SHOP_ID]');
  }

  /**
   * STEP 3 — IDENTITY MAP LOOKUP (NOT IMPLEMENTED YET)
   * --------------------------------------------------
   * Must resolve:
   * - external_order_id
   * From: external_order_identity_map
   */
    await db('fulfillment_executions')
      .where({ decision_id: job.decision_id })
      .update({
        status: 'failure',
        error: '[FULFILLMENT_NOT_IMPLEMENTED]'
      });

  throw new Error('[FULFILLMENT_NOT_IMPLEMENTED]');
};