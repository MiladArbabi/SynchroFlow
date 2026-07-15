// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import { ensureOrderIdentityExists }
  from '../../../services/order-identity-guard.service.js';

type ShopifyFulfillmentPayload = {
  id: string | number;
  order_id: string | number;
  status?: string | null;
  fulfillment_status?: string | null;
  updated_at?: string;
  created_at?: string;
};

function isShopifyFulfillmentPayload(
  payload: unknown
): payload is ShopifyFulfillmentPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'id' in payload &&
    'order_id' in payload
  );
}

// ISS-RLS2: trx REQUIRED — see handleOrderCreated.ts header comment.
export async function handleOrderFulfillment(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {

  const rawPayload = envelope.rawPayload;

  console.log('[FULFILLMENT_RAW]', JSON.stringify(rawPayload));

  /**
   * INGESTION TRACE
   * ----------------
   * Emits entry signal for webhook ingestion pipeline.
   * Enables operational debugging and replay tracing.
   */
  console.log('[ORDER_FULFILLMENT_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    hasPayload: !!envelope.rawPayload,
  });

  if (!isShopifyFulfillmentPayload(rawPayload)) {
    console.error('[FULFILLMENT_INGESTION_REJECTED][INVALID_PAYLOAD]', {
      receivedKeys: rawPayload ? Object.keys(rawPayload as any) : null
    });
    throw new Error('FULFILLMENT_INVALID_PAYLOAD');
  }

  const shopDomain = envelope.shopDomain;
  if (!shopDomain) {
    console.error('[FULFILLMENT_INGESTION_REJECTED][MISSING_SHOP_DOMAIN]');
    throw new Error('FULFILLMENT_MISSING_SHOP_DOMAIN');
  }

  const installation = await trx('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[FULFILLMENT_INGESTION_REJECTED][INSTALLATION_NOT_FOUND]', {
      shopDomain
    });
    throw new Error('FULFILLMENT_INSTALLATION_NOT_FOUND');
  }

  const shopId = installation.shop_id;

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   */
  const eventTime =
    (rawPayload as any).updated_at ??
    (rawPayload as any).created_at ??
    null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Fulfillment missing event_time at ingestion'
    );
  }

  /**
   * INGESTION IDENTITY ENFORCEMENT
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  /**
   * FULFILLMENT IDENTITY GUARD
   * --------------------------
   * Fulfillment must never enter canonical layer
   * before baseline order exists.
   *
   * If identity missing:
   * - Fetch order via Shopify GraphQL
   * - Emit orders/sync
   *
   * Deterministic and replay-safe.
   */
  const externalOrderId = String(rawPayload.order_id);

  await ensureOrderIdentityExists(
    shopId,
    shopDomain,
    externalOrderId,
    trx
  );

  let domainEventId: number;
  /**
   * DOMAIN EVENT PAYLOAD NORMALIZATION (ID ONLY)
   * --------------------------------------------
   * DB constraint enforces:
   *   event_payload.id MUST NOT be gid://
   *
   * This is the ONLY enforced invariant.
   */
  const normalizedPayload = { ...(envelope.rawPayload as any) };

  /**
   * FULFILLMENT STATUS RESOLUTION (CRITICAL)
   * ----------------------------------------
   * Shopify provides:
   * - status → execution result ("success")
   * - fulfillment_status → order-level fulfillment state
   *
   * RULE:
   * - Prefer fulfillment_status if present
   * - Fallback to status ONLY if missing
   *
   * This ensures:
   * - correct semantic mapping
   * - stable downstream projection
   */
  const resolvedStatus =
    normalizedPayload.fulfillment_status ??
    normalizedPayload.status;

  if (!resolvedStatus) {
    console.error('[FULFILLMENT_STATUS_MISSING_INGESTION]', {
      eventId: envelope.eventId,
      payload: normalizedPayload,
    });

    throw new Error('[FULFILLMENT_STATUS_MISSING]');
  }

  /**
   * Normalize into single canonical field
   */
  normalizedPayload.status = resolvedStatus;

  /**
   * PAYLOAD SCHEMA ENFORCEMENT (MINIMAL CONTRACT)
   * ---------------------------------------------
   * Ensures required fields exist before entering domain_events.
   *
   * Prevents:
   * - invalid projection assumptions
   * - replay-time failures
   */
  if (!normalizedPayload.order_id) {
    console.error('[FULFILLMENT_SCHEMA_VIOLATION][MISSING_ORDER_ID]', {
      eventId: envelope.eventId,
      payload: normalizedPayload,
    });

    throw new Error('[FULFILLMENT_SCHEMA_INVALID]');
  }

  if (!normalizedPayload.id) {
    console.error('[FULFILLMENT_SCHEMA_VIOLATION][MISSING_FULFILLMENT_ID]', {
      eventId: envelope.eventId,
      payload: normalizedPayload,
    });

    throw new Error('[FULFILLMENT_SCHEMA_INVALID]');
  }

  if (
    typeof normalizedPayload.id === 'string' &&
    normalizedPayload.id.startsWith('gid://')
  ) {
    normalizedPayload.id = normalizedPayload.id.split('/').pop();
  }

  try {
    const result = await trx('domain_events')
      .insert({
        shop_id: shopId,
        /**
         * DOMAIN EVENT TYPE ALIGNMENT
         * ---------------------------
         * Must match projection handler:
         *   handleOrdersFulfilled → 'orders/fulfilled'
         *
         * Mismatch breaks rebuild determinism.
         */
        event_type: 'orders/fulfilled',
        event_payload: normalizedPayload,
        event_time: new Date(eventTime),
        event_version: 1,
        /**
         * EXTERNAL EVENT ID NORMALIZATION (CRITICAL)
         * ------------------------------------------
         * DB constraint: external_event_id must NOT contain gid://
         *
         * Shopify sends GIDs → must normalize before persistence
         * to prevent hard DB failures and ingestion loss.
         */
        external_event_id: (() => {
          let id = String(envelope.eventId);

          if (id.startsWith('gid://')) {
            id = id.split('/').pop()!;
          }

          return id;
        })(),
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];
    
  } catch (error: any) {

    /**
     * DUPLICATE DELIVERY HANDLING
     * ---------------------------
     * Unique constraint:
     * (shop_id, external_event_id)
     */
    if (error?.code === '23505') {

      console.warn('[DOMAIN_EVENT_DUPLICATE]', {
        shopId,
        externalEventId: envelope.eventId,
        eventType: 'orders/fulfilled',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}
