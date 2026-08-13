/**
 * Inventory Webhook Handler
 * --------------------------
 * Contract:
 * - Mirror Shopify inventory exactly
 * - No direct writes to inventory_truth
 * - All corrections must be movements
 * - Idempotent via external_event_id (DB-enforced)
 */

import type { Knex } from 'knex';
import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

interface ShopifyInventoryPayload {
  inventory_item_id?: number;
  available?: number;
  location_id?: number;
  updated_at?: string;
  admin_graphql_api_id?: string;
}

// ISS-RLS2: trx REQUIRED — see handleOrderCreated.ts header comment.
export async function handleInventoryLevelUpdate(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
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

  const installation = await trx('shopify_app_installations')
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
    console.error('[INVENTORY_UPDATE_PAYLOAD_GUARD_FAILED]', {
      eventId: envelope.eventId,
      hasAvailable: typeof payload?.available === 'number',
    });

    /**
     * INGESTION FAILURE PERSISTENCE
     * ------------------------------
     * Even invalid payloads MUST be persisted for:
     * - auditability
     * - replay
     * - debugging real-world Shopify inconsistencies
     */
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'inventory_levels/update.invalid_payload',
      event_payload: envelope.rawPayload,
      event_time: new Date(),
      event_version: 1,
      external_event_id: `${envelope.eventId}:invalid_payload`,
    });

    return;
  }

  /**
   * GID RESOLUTION (CRITICAL)
   * --------------------------------------
   * Shopify inventory_levels/update sends:
   *   admin_graphql_api_id: "gid://shopify/InventoryLevel/xxx?inventory_item_id=yyy"
   *
   * Must extract inventory_item_id from query string and construct
   * a clean InventoryItem GID to match external_product_identity_map.
   */
  let externalInventoryItemGid: string | null = null;

  if (payload.admin_graphql_api_id) {
    const url = new URL(payload.admin_graphql_api_id.replace('gid://', 'https://gid/'));
    const inventoryItemId = url.searchParams.get('inventory_item_id');
    if (inventoryItemId) {
      externalInventoryItemGid = `gid://shopify/InventoryItem/${inventoryItemId}`;
    }
  }

  if (!externalInventoryItemGid && payload.inventory_item_id) {
    externalInventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
  }

  if (!externalInventoryItemGid) {
    console.error('[INVENTORY_UPDATE_IDENTITY_GUARD_FAILED]', {
      eventId: envelope.eventId,
      payload,
    });

    /**
     * INGESTION FAILURE PERSISTENCE
     * ------------------------------
     * Prevent silent desync by persisting invalid identity events.
     */
    await trx('domain_events').insert({
      shop_id: shopId,
      event_type: 'inventory_levels/update.invalid_identity',
      event_payload: envelope.rawPayload,
      event_time: new Date(),
      event_version: 1,
      external_event_id: `${envelope.eventId}:invalid_identity`,
    });

    return;
  }

  /**
   * EVENT TIME NORMALIZATION (FAIL-SAFE)
   * ------------------------------------
   * Shopify timestamps are not guaranteed.
   * We MUST:
   * - never fail ingestion
   * - preserve original signal
   * - fallback deterministically
   */
  let eventTime: Date;

  if (payload.updated_at) {
    const parsed = new Date(payload.updated_at);

    if (isNaN(parsed.getTime())) {
      console.error('[EVENT_TIME_INVALID_FORMAT]', {
        eventId: envelope.eventId,
        rawValue: payload.updated_at,
      });

      eventTime = new Date(); // fallback
    } else {
      eventTime = parsed;
    }
  } else {
    console.error('[EVENT_TIME_MISSING]', {
      eventId: envelope.eventId,
    });

    eventTime = new Date(); // fallback
  }

  /**
   * SHOPIFY INVENTORY OBSERVATION CONTRACT
   * --------------------------------------
   * inventory_levels/update is an external observation only.
   *
   * It MUST NOT:
   * - create inventory_movements
   * - change physical inventory
   * - reconcile against WH-{shopId}-ROOT
   *
   * Physical inventory remains authoritative in the laSyncro ledger.
   * Drift detection/reconciliation is handled separately from ingestion.
   */
  let domainEventId: number;
  await trx.raw('SAVEPOINT inventory_level_domain_event');
  try {
    const result = await trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'inventory_levels/update',
        event_payload: envelope.rawPayload,
        event_time: eventTime,
        event_version: 1,
        external_event_id: envelope.eventId,
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];
    await trx.raw('RELEASE SAVEPOINT inventory_level_domain_event');
  } catch (error: any) {
    await trx.raw('ROLLBACK TO SAVEPOINT inventory_level_domain_event');
    await trx.raw('RELEASE SAVEPOINT inventory_level_domain_event');
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
