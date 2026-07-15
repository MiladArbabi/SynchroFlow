// apps/backend/src/api/shopify/handlers/handleOrderPaid.ts
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import { buildExternalEventId } from '../../webhooks/buildExternalEventId.js';

type ShopifyOrderPaidPayload = {
  id?: string | number;
  updated_at?: string;
  processed_at?: string;
};

function isOrderPaidPayload(payload: unknown): payload is ShopifyOrderPaidPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'id' in payload
  );
}

// ISS-RLS2: trx REQUIRED — see handleOrderCreated.ts header comment.
export async function handleOrderPaid(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {

  const rawPayload = envelope.rawPayload;

  /**
   * INGESTION TRACE
   * ----------------
   * Emits entry signal for webhook ingestion pipeline.
   * Enables operational debugging and replay tracing.
   */
  console.log('[ORDER_PAID_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    hasPayload: !!envelope.rawPayload,
  });

  if (!isOrderPaidPayload(rawPayload)) {
    return;
  }

  const shopDomain = envelope.shopDomain;
  /**
   * INGESTION GUARD — SHOP DOMAIN
   * -----------------------------
   * Webhook delivery without shop domain indicates
   * malformed transport envelope.
   *
   * This must emit an operational signal instead
   * of silently dropping the event.
   */
  if (!shopDomain) {
    console.error('[ORDER_PAID_GUARD_FAILED]', {
      reason: 'missing_shop_domain',
      envelope,
    });
    return;
  }

  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  /**
   * INGESTION GUARD — INSTALLATION RESOLUTION
   * -----------------------------------------
   * If Shopify installation cannot be resolved,
   * the event cannot be attributed to a tenant.
   *
   * This condition must be observable.
   */
  if (!installation) {
    console.error('[ORDER_PAID_INSTALLATION_NOT_FOUND]', {
      shopDomain,
    });
    return;
  }

  const shopId = installation.shop_id;

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Payment must carry canonical event-time.
   */
  const eventTime =
    (rawPayload as any).updated_at ??
    (rawPayload as any).processed_at ??
    null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Payment missing event_time at ingestion'
    );
  }

  /**
   * INGESTION IDENTITY ENFORCEMENT
   * ------------------------------
   * external_event_id is REQUIRED and persisted.
   * DB uniqueness guarantees idempotency.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  let domainEventId: number;

  try {

    const result = await trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/paid',
        event_payload: rawPayload,
        event_time: new Date(eventTime),
        event_version: 1,
        /**
         * EXTERNAL EVENT ID — CANONICAL FORMAT (CRITICAL)
         * ------------------------------------------------
         * Must match handleOrderCreated.ts paid emission format:
         * webhook:shopify:{UUID}:paid
         *
         * Mismatched formats defeat uniqueness constraint → duplicate
         * orders/paid domain events → double aggregate_version increment.
         */
        external_event_id: buildExternalEventId({
          source: 'webhook',
          integration: 'shopify',
          eventId: envelope.eventId,
          suffix: 'paid',
        }),
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];

  } catch (error: any) {

    /**
     * DUPLICATE DELIVERY HANDLING
     * ---------------------------
     * Unique constraint:
     * (shop_id, external_event_id)
     *
     * PostgreSQL error code 23505 = unique_violation
     */
    if (error?.code === '23505') {

      console.warn('[DOMAIN_EVENT_DUPLICATE]', {
        shopId,
        externalEventId: envelope.eventId,
        eventType: 'orders/paid',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}
