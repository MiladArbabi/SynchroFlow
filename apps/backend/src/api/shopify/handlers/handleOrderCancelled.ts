// apps/backend/src/api/shopify/handlers/handleOrderCancelled.ts
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { buildExternalEventId } from '../../webhooks/buildExternalEventId.js';

type ShopifyOrderCancelledPayload = {
  id?: string | number;
  cancelled_at?: string;
  updated_at?: string;
};

function isOrderCancelledPayload(
  payload: unknown
): payload is ShopifyOrderCancelledPayload {
  return typeof payload === 'object' && payload !== null && 'id' in payload;
}

// ISS-RLS2: trx REQUIRED — see handleOrderCreated.ts header comment.
export async function handleOrderCancelled(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const rawPayload = envelope.rawPayload;

  console.log('[ORDER_CANCELLED_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    hasPayload: !!envelope.rawPayload,
  });

  if (!isOrderCancelledPayload(rawPayload)) {
    return;
  }

  const shopDomain = envelope.shopDomain;

  if (!shopDomain) {
    console.error('[ORDER_CANCELLED_GUARD_FAILED]', {
      reason: 'missing_shop_domain',
      envelope,
    });
    return;
  }

  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[ORDER_CANCELLED_INSTALLATION_NOT_FOUND]', { shopDomain });
    return;
  }

  const shopId = installation.shop_id;

  /**
   * EVENT-TIME PRECEDENCE
   * ---------------------
   * cancelled_at is the canonical moment the merchant cancelled.
   * updated_at is a fallback only — it moves on unrelated edits.
   */
  const eventTime =
    (rawPayload as any).cancelled_at ?? (rawPayload as any).updated_at ?? null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Cancellation missing event_time at ingestion'
    );
  }

  if (!envelope.eventId) {
    throw new Error('[INGESTION_IDENTITY_VIOLATION] Missing external eventId');
  }

  await trx.raw('SAVEPOINT order_cancelled_domain_event');
  try {
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'orders/cancelled',
      event_payload: rawPayload,
      event_time: new Date(eventTime),
      event_version: 1,
      external_event_id: buildExternalEventId({
        source: 'webhook',
        integration: 'shopify',
        eventId: envelope.eventId,
        suffix: 'cancelled',
      }),
    });
    await trx.raw('RELEASE SAVEPOINT order_cancelled_domain_event');
  } catch (error: any) {
    await trx.raw('ROLLBACK TO SAVEPOINT order_cancelled_domain_event');
    await trx.raw('RELEASE SAVEPOINT order_cancelled_domain_event');
    // 23505 = unique_violation on (shop_id, external_event_id).
    // Shopify retries deliveries; replay must not create a second event.
    if (error?.code === '23505') {
      console.warn('[DOMAIN_EVENT_DUPLICATE]', {
        shopId,
        externalEventId: envelope.eventId,
        eventType: 'orders/cancelled',
      });
      return;
    }
    throw error;
  }
}