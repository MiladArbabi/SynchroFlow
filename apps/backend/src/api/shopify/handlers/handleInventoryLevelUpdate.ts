/**
 * Inventory Webhook Handler
 * --------------------------
 * Contract:
 * - Mirror Shopify inventory exactly
 * - No direct writes to inventory_truth
 * - All corrections must be movements
 * - Idempotent via external_event_id (DB-enforced)
 */

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

interface ShopifyInventoryPayload {
  inventory_item_id?: number;
  available?: number;
  location_id?: number;
  updated_at?: string;
  admin_graphql_api_id?: string;
}

export async function handleInventoryLevelUpdate(
  envelope: WebhookEnvelope
): Promise<void> {

  const payload = envelope.rawPayload as Partial<ShopifyInventoryPayload>;
  
  /**
   * INGESTION TRACE
   * ----------------
   * Emits entry signal for webhook ingestion pipeline.
   * Enables operational debugging and replay tracing.
   */
  console.log('[INVENTORY_UPDATE_HANDLER_ENTRY]', {
    shopDomain: envelope.shopDomain,
    eventId: envelope.eventId,
    hasPayload: !!envelope.rawPayload,
  });

  const shopDomain = envelope.shopDomain;

  if (!shopDomain) {
    console.error('[INVENTORY_INGESTION_VIOLATION] Missing shopDomain', {
      eventId: envelope.eventId,
    });
    return;
  }

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[INVENTORY_INGESTION_VIOLATION] Installation not found', {
      shopDomain,
      eventId: envelope.eventId,
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

  if (
    payload == null ||
    typeof payload.available !== 'number'
  ) {
    /**
     * INGESTION GUARD — PAYLOAD SHAPE
     * -------------------------------
     * Inventory webhook missing canonical available quantity.
     * Must emit explicit operational signal.
     */
    console.error('[INVENTORY_UPDATE_PAYLOAD_GUARD_FAILED]', {
      eventId: envelope.eventId,
      hasAvailable: typeof payload?.available === 'number',
    });
    return;
  }

  let externalInventoryItemGid: string | null = null;

  if (payload.admin_graphql_api_id) {
    externalInventoryItemGid = payload.admin_graphql_api_id;
  } else if (payload.inventory_item_id) {
    externalInventoryItemGid =
      `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  }

  if (!externalInventoryItemGid) {
    /**
     * INGESTION GUARD — INVENTORY ITEM ID
     * -----------------------------------
     * Inventory webhook missing canonical item identity.
     * Event must be observable to prevent silent desync.
     */
    console.error('[INVENTORY_UPDATE_IDENTITY_GUARD_FAILED]', {
      eventId: envelope.eventId,
      payload,
    });
    return;
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   */
  if (!payload.updated_at) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Inventory missing event_time at ingestion'
    );
  }

  let domainEventId: number;

  try {

    const result = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'inventory_levels/update',
        event_payload: envelope.rawPayload,
        event_time: new Date(payload.updated_at),
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
        eventType: 'inventory_levels/update',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}