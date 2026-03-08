// apps/backend/src/api/shopify/handlers/handleOrderCreated.ts
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';

type ShopifyOrderCreatePayload = {
  id: number | string;
  admin_graphql_api_id?: string;

  /**
   * PAYMENT STATUS (Shopify REST)
   * ------------------------------
   * Determines whether order is already paid
   * when created.
   */
  financial_status?: string;

  currency: string;
  total_price: string | number;
  subtotal_price?: string | number;
  total_tax?: string | number;
  created_at: string;
  updated_at: string;
  processed_at?: string;
  source_name?: string;
  line_items?: Array<{
    id: number | string;
    product_id?: number | string;
    variant_id?: number | string;
    title: string;
    sku?: string;
    quantity: number;
    price: string | number;
  }>;
};

export async function handleOrderCreated(
  envelope: WebhookEnvelope
): Promise<void> {

  const raw = envelope.rawPayload as Partial<ShopifyOrderCreatePayload>;

  /**
   * INGESTION TRACE
   * ----------------
   * Emits entry signal for webhook ingestion pipeline.
   * Enables operational debugging and replay tracing.
   */
  console.log('[ORDER_CREATE_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    hasPayload: !!envelope.rawPayload,
  });

  console.log('[ORDER CREATE HANDLER] ENTERED');

  const shopDomain = envelope.shopDomain;

  if (!raw?.id || !raw.created_at || !raw.updated_at || !shopDomain) {
    console.error('[ORDER CREATE GUARD FAILED]', {
      hasId: !!raw?.id,
      hasCreatedAt: !!raw?.created_at,
      hasUpdatedAt: !!raw?.updated_at,
      shopDomain,
    });
    return;
  }

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[ORDER CREATE INSTALLATION NOT FOUND]', {
      shopDomain,
    });
    return;
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Canonical event-time must be persisted at ingestion boundary.
   * Never rely on worker-only extraction.
   */
  const eventTime = raw.created_at ?? null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Order create missing created_at at ingestion'
    );
  }

  const shopId = installation.shop_id;

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

    const result = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: raw,
        event_time: new Date(eventTime),
        event_version: 1,
        external_event_id: envelope.eventId,
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];

    /**
     * PAYMENT STATE DETECTION
     * -----------------------
     * Shopify may send orders already paid at creation.
     * In that case we must emit a deterministic orders/paid
     * domain event so projections can update payment_state.
     */
    const financialStatus = raw.financial_status?.toLowerCase();

    if (financialStatus === 'paid') {

      const paidEvent = await db('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'orders/paid',
          event_payload: {
            id: raw.id,
          },
          event_time: new Date(eventTime),
          event_version: 1,
          external_event_id: `${envelope.eventId}:paid`,
        })
        .returning('id');

      /**
       * OUTBOX DISPATCH RULE
       * --------------------
       * Domain events must NOT be published directly to RabbitMQ.
       *
       * The DB trigger `domain_event_auto_outbox` automatically inserts
       * a row into `domain_event_outbox` which is then dispatched by
       * the domain-event-outbox worker.
       *
       * This guarantees:
       * - transactional event durability
       * - no lost projections
       * - deterministic replay safety
       */
    }

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
        eventType: 'orders/create',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error; // Unexpected DB error
  }

  console.log('[DOMAIN_EVENT_INSERTED]', domainEventId);

  /**
   * OUTBOX DISPATCH RULE
   * --------------------
   * Event dispatch is handled by the domain_event_outbox dispatcher.
   *
   * The `domain_event_auto_outbox` trigger guarantees that
   * every inserted domain event produces an outbox entry.
   *
   * Direct queue publishing here would create a dual dispatch
   * path and violate event transport determinism.
   */
};
