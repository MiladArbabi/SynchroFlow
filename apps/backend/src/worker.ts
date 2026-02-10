// apps/backend/src/worker.ts
import { getQueueChannel } from './queue';
import db from './db';
import { CanonicalCommerceIngestionService } from 'api-src/services/canonical-commerce-ingestion.service';
import { OrderNexusCanonicalIngestionService } from 'api-src/services/order-nexus-canonical-ingestion.service';

// Lazily obtain the specific channel for 'events' so tests can safely mock getQueueChannel
let eventChannel: ReturnType<typeof getQueueChannel> | null = null;
function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

// Lazily create service instances so test harness can mock the classes before instantiation
let canonicalIngestionService: InstanceType<typeof CanonicalCommerceIngestionService> | null = null;
function getCanonicalIngestionService() {
  if (!canonicalIngestionService) {
    canonicalIngestionService = new CanonicalCommerceIngestionService();
  }
  return canonicalIngestionService as NonNullable<typeof canonicalIngestionService>;
}

let orderNexusCanonicalIngestionService: InstanceType<typeof OrderNexusCanonicalIngestionService> | null = null;
function getOrderNexusCanonicalIngestionService() {
  if (!orderNexusCanonicalIngestionService) {
    orderNexusCanonicalIngestionService = new OrderNexusCanonicalIngestionService();
  }
  return orderNexusCanonicalIngestionService as NonNullable<typeof orderNexusCanonicalIngestionService>;
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
        raw_payload: Record<string, any>;
      }>();

    if (!stagedEvent) {
      console.error(
        `[worker] Staged event with id ${staged_event_id} not found.`,
      );
      getEventChannel().ack(msg as any);
      return;
    }

    // 2) NEW: persist canonical order snapshot
    // For FT0 we assume raw_payload is already in CanonicalOrder shape
    // for Shopify order events. Other event types can be handled separately.
    // 🚧 HARD PRODUCT INGESTION BARRIER (FINITE)
    const productIngested = await db('shop_ingestion_events')
      .where({
        shop_id: stagedEvent.shop_id,
        module_id: 'product',
        event: 'ingested',
      })
      .first();

    if (!productIngested) {
      console.error(
        '[worker][FATAL] No canonical products exist — blocking order ingestion',
        { staged_event_id, shop_id: stagedEvent.shop_id }
      );

      // Terminal ACK — no infinite requeue
      getEventChannel().ack(msg as any);
      return;
    }

    try {
      await getCanonicalIngestionService().insertCanonicalOrder(
        stagedEvent.raw_payload as any,
      );
    
    /**
     * Order Ingestion Barrier
     * --------------------------------
     * Orders MUST NOT ingest until product anchors exist.
     *
     * If canonical identity is missing, the message is requeued
     * to preserve replayability once product ingestion completes.
     */

    } catch (e: any) {
      if (
        String(e?.message || '').includes('CANONICAL_IDENTITY_VIOLATION')
      ) {
        /**
         * TERMINAL GUARD — prevent infinite requeue
         * ----------------------------------------
         * Requeue is only valid if canonical products may still appear.
         * If NO canonical_products exist for this shop, progress is impossible.
         */
        const productCountRow = await db('canonical_products')
          .where({ shop_id: stagedEvent.shop_id })
          .count<{ count: string }>('canonical_product_id as count')
          .first();

        const productCount = Number(productCountRow?.count ?? 0);

        if (productCount === 0) {
          console.error(
            '[worker][FATAL] No canonical products exist — blocking order ingestion',
            { staged_event_id, shop_id: stagedEvent.shop_id }
          );

          // 🚫 ACK to stop infinite loop — progress is impossible
          getEventChannel().ack(msg as any);
          return;
        }

        console.error(
          '[worker][BLOCKED] Product anchors missing after ingestion signal',
          { staged_event_id }
        );

        // Terminal ACK — truth beats retries
        getEventChannel().ack(msg as any);
        return;
      }

      console.error(
        '[worker] Failed to persist canonical order from staged event:',
        e,
      );

      // Non-identity errors are acknowledged to avoid poison loops
      getEventChannel().ack(msg as any);
      return;
    }

    // 3b) Enqueue canonical order into OrderNexus ingestion flow
    try {
      const canonicalOrder = stagedEvent.raw_payload as any;
      if (canonicalOrder && canonicalOrder.id && stagedEvent.shop_id) {
        await getOrderNexusCanonicalIngestionService().enqueueOrderForOrderNexus(
          stagedEvent.shop_id,
          canonicalOrder.id,
        );
      }
    } catch (e) {
      console.error(
        '[worker] Failed to enqueue canonical order for OrderNexus:',
        e,
      );
      // Same policy: log but do not poison the queue for FT0.
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