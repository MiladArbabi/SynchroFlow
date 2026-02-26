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
   * IDEMPOTENCY ENFORCEMENT
   * -----------------------
   * Upstream eventId must be persisted
   * to activate staged_events unique constraint.
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
   * INVENTORY STAGING (UNIFIED INGESTION)
   * -------------------------------------
   * Inventory events must enter canonical pipeline via staged_events.
   * Direct domain mutation from webhook is forbidden.
   *
   * Downstream worker is responsible for:
   * - identity resolution
   * - movement insertion
   * - projection rebuild
   * - obligation recompute
   */

  const [id] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'inventory_levels/update',
      raw_payload: envelope.rawPayload,
      shop_id: shopId,
      external_event_id: envelope.eventId,
      event_time: new Date(payload.updated_at),
    })
    .returning('id');

  /**
   * Normalize Knex returning shape.
   */
  const stagedEventId =
    typeof id === 'object' && id !== null
      ? (id as any).id
      : id;

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(JSON.stringify({ staged_event_id: stagedEventId }))
  );
}