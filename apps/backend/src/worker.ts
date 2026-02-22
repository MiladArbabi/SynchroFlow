// apps/backend/src/worker.ts
import { getQueueChannel } from './queue.js';
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

import { publishReconciliationJob } from './queues/reconciliation.queue.js';

// Lazily obtain the specific channel for 'events' so tests can safely mock getQueueChannel
let eventChannel: ReturnType<typeof getQueueChannel> | null = null;
function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

// This is the function our test is targeting
export async function processMessage(msg: { content: Buffer } | null) {
  if (msg === null) {
    return;
  }

  const content = msg.content.toString();

  try {
    const { staged_event_id } = JSON.parse(content);

    if (!staged_event_id) {
      console.error('[worker] Message is missing staged_event_id');
      getEventChannel().ack(msg as any);
      return;
    }

    // 1) Load staged event
    const stagedEvent = await db('staged_events')
      .where({ id: staged_event_id })
      .first<{
        id: number;
        shop_id: number;
        event_type: string;
        raw_payload: Record<string, any>;
      }>();

    if (!stagedEvent) {
      console.error(
        `[worker] Staged event with id ${staged_event_id} not found.`,
      );
      getEventChannel().ack(msg as any);
      return;
    }

  /**
   * Canonical Order Ingestion (Schema-Aligned)
   * -----------------------------------------
   * Creates:
   * - orders
   * - external_order_identity_map
   * - order_fulfillment_status
   *
    * Idempotency enforced via:
    *   external_order_identity_map
    *   UNIQUE (shop_id, platform, external_order_id)
   */

  if (stagedEvent.event_type === 'orders/create') {
    const payload = stagedEvent.raw_payload as any;
    const externalOrderId = String(payload.id);

    /**
     * CANONICAL FORMAT GUARD
     * ----------------------
     * Shopify external order identity must be numeric string.
     * Reject GID or malformed identifiers at ingestion boundary.
     */
    if (!/^\d+$/.test(externalOrderId)) {
      throw new Error(
        `[IDENTITY_CANONICAL_VIOLATION] Non-numeric external_order_id: ${externalOrderId}`
      );
    }

    let newlyCreatedOrderId: string | null = null;

    await db.transaction(async (trx) => {

      const existingIdentity = await trx('external_order_identity_map')
      .where({
        shop_id: stagedEvent.shop_id,
        platform: 'shopify',
        external_order_id: externalOrderId,
      })
      .first();

    if (existingIdentity) return;

      const lasyncroOrderId = crypto.randomUUID();
      newlyCreatedOrderId = lasyncroOrderId;

      // Insert canonical order only after identity secured
      await trx('orders').insert({
        lasyncro_order_id: lasyncroOrderId,
        shop_id: stagedEvent.shop_id,
        currency: payload.currency,
        total_price: payload.total_price,
        subtotal_price: payload.subtotal_price ?? payload.total_price,
        total_tax: payload.total_tax ?? 0,
        order_created_at: payload.created_at,
        order_updated_at: payload.updated_at,
      });

      await trx('external_order_identity_map').insert({
        lasyncro_order_id: lasyncroOrderId,
        shop_id: stagedEvent.shop_id,
        platform: 'shopify',
        external_order_id: externalOrderId,
      });

      // Insert fulfillment status
      await trx('order_fulfillment_status').insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending',
      });

      /**
       * Revenue Unit Ingestion
       * ----------------------
       * For each Shopify line item:
       * - Resolve variant via external_product_identity_map
       * - Insert into order_revenue_units
       * - Skip if variant mapping not found
       */

      if (Array.isArray(payload.line_items)) {
        for (const item of payload.line_items) {
          const externalVariantId = item.variant_id
            ? `gid://shopify/ProductVariant/${item.variant_id}`
            : null;

          if (!externalVariantId) continue;

          const identity = await trx('external_product_identity_map')
            .where({
              shop_id: stagedEvent.shop_id,
              platform: 'shopify',
              external_variant_id: externalVariantId,
            })
            .first();

          if (!identity) continue; // Strict: skip unmapped variants

          const variant = await trx('variants')
            .where({ lasyncro_variant_id: identity.lasyncro_variant_id })
            .first();

          if (!variant) continue;

          await trx('order_revenue_units')
            .insert({
              lasyncro_revenue_unit_id: crypto.randomUUID(),
              lasyncro_order_id: lasyncroOrderId,
              lasyncro_product_id: variant.lasyncro_product_id,
              lasyncro_variant_id: identity.lasyncro_variant_id,
              sku: item.sku ?? null,
              title: item.title,
              quantity: item.quantity,
              unit_price: item.price,
              line_total: Number(item.price) * Number(item.quantity),
            })
            .onConflict(['lasyncro_order_id', 'lasyncro_variant_id'])
            .ignore();
        }
      }
    });

    if (newlyCreatedOrderId) {
      await publishReconciliationJob(newlyCreatedOrderId);
    }
  }

    // 4) Success path → ack
    getEventChannel().ack(msg as any);
  } catch (error) {
    // Mapping / processing failed. Our current policy for FT0:
    // - Do not poison the queue for mapping/validation/runtime errors.
    // - Log the error and ACK the message so it is not retried endlessly.
    console.error('[worker] Error processing message:', error);
    try {
      getEventChannel().ack(msg as any);
    } catch (ackErr) {
      // If ack fails for some reason, log it (but avoid throwing from the handler).
      console.error('[worker] Failed to ack failed message:', ackErr);
    }
  }
}

// This function starts the consumer
export function startWorker() {
  console.log('[worker] Starting API worker...');
  getEventChannel().consume('events', processMessage, { noAck: false });
  console.log('[worker] Worker started. Waiting for events...');
}