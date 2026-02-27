/**
 * Inventory Webhook Handler
 * --------------------------
 * Contract:
 * - Mirror Shopify inventory exactly
 * - No direct writes to inventory_truth
 * - All corrections must be movements
 * - Idempotent via device_event_id
 */

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { getQueueChannel } from '../../../queue.js';

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
   * NOTE:
   * Idempotency must be enforced at domain boundary.
   * No mutable ingestion buffer.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  console.debug('[inventory_sync] payload keys', Object.keys(payload || {}));

if (
  payload == null ||
  typeof payload.available !== 'number'
) {
  console.warn('[inventory_sync] invalid payload shape', {
    eventId: envelope.eventId,
    hasAvailable: typeof payload?.available === 'number',
  });
  return;
}

  const available: number = payload.available;
  
  let externalInventoryItemGid: string | null = null;

  if (payload.admin_graphql_api_id) {
    externalInventoryItemGid = payload.admin_graphql_api_id;
  } else if (payload.inventory_item_id) {
    externalInventoryItemGid =
      `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  }

  if (!externalInventoryItemGid) {
    console.warn('[inventory_sync] missing inventory item id', {
      eventId: envelope.eventId,
      payload,
    });
    return;
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Inventory update must carry canonical event-time.
   * Field: updated_at
   */
  if (!payload.updated_at) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Inventory missing event_time at ingestion'
    );
  }

  /**
   * IMMUTABLE DOMAIN EVENT INSERT
   * -----------------------------
   * Append-only canonical event log.
   */
  const [domainEventId] = await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'inventory_levels/update',
      event_payload: envelope.rawPayload,
      event_time: new Date(payload.updated_at),
      event_version: 1,
      event_sequence: db.raw(
        `
        COALESCE(
          (SELECT MAX(event_sequence) + 1
          FROM domain_events
          WHERE shop_id = ?),
          1
        )
        `,
        [shopId]
      ),
    })
    .returning('id');

    const finalDomainEventId =
    typeof domainEventId === 'object' && domainEventId !== null
      ? (domainEventId as any).id
      : domainEventId;

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(
      JSON.stringify({ domain_event_id: finalDomainEventId })
    )
  );
}