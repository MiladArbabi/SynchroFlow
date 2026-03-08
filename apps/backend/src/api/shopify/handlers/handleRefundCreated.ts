/**
 * REFUND EXECUTION CONTRACT
 * ------------------------
 * - refund_executions is the ONLY source of financial truth
 * - Webhooks may replay; DB enforces idempotency
 * - Revenue mutation happens in a separate resolver phase
 */

// apps/backend/src/api/shopify/handlers/handleRefundCreated.ts

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

type ShopifyRefundPayload = {
  id: number | string;
  order_id: number | string;
  created_at?: string;
  refund_line_items?: Array<{
    quantity?: number;
    subtotal?: string | number;
    line_item?: {
      id?: number | string;
    };
  }>;
};

export async function handleRefundCreated(
  envelope: WebhookEnvelope
): Promise<void> {

  const { rawPayload, shopDomain } = envelope;

  console.log('[REFUND_HANDLER_ENTRY]', {
    shopDomain,
    hasRawPayload: !!rawPayload,
  });

  /**
   * INGESTION GUARD — SHOP DOMAIN
   * -----------------------------
   * Missing shop domain means webhook transport envelope is malformed.
   * Must emit operational signal to avoid silent event loss.
   */
  if (!shopDomain) {
    console.error('[REFUND_CREATE_GUARD_FAILED]', {
      reason: 'missing_shop_domain',
      envelope,
    });
    return;
  }

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  /**
   * INGESTION GUARD — INSTALLATION RESOLUTION
   * -----------------------------------------
   * Refund event cannot be attributed to tenant.
   * Must be observable.
   */
  if (!installation) {
    console.error('[REFUND_CREATE_INSTALLATION_NOT_FOUND]', {
      shopDomain,
    });
    return;
  }

  const shopId = installation.shop_id;

  /**
   * INGESTION IDENTITY ENFORCEMENT
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  const refundPayload = rawPayload as Partial<ShopifyRefundPayload>;

  const refundId = refundPayload.id;
  const platformOrderId = refundPayload.order_id;
  const refundCreatedAt = refundPayload.created_at;

  /**
   * INGESTION GUARD — REFUND IDENTITY
   * ---------------------------------
   * Refund webhook missing canonical identifiers.
   * Event must be observable for investigation.
   */
  if (!refundId || !platformOrderId) {
    console.error('[REFUND_CREATE_IDENTITY_GUARD_FAILED]', {
      refundId,
      platformOrderId,
      shopDomain,
    });
    return;
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   */
  if (!refundCreatedAt) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Refund missing event_time at ingestion'
    );
  }

  let domainEventId: number;

  try {

    const result = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'refunds/create',
        event_payload: rawPayload,
        event_time: new Date(refundCreatedAt),
        event_version: 1,
        external_event_id: envelope.eventId,
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
        eventType: 'refunds/create',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}