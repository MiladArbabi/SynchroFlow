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
    await db('domain_events').insert({
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
    await db('domain_events').insert({
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
   * INVENTORY MOVEMENT — RECONCILIATION CORRECTION (IN-02)
   * -------------------------------------------------------
   * MUST run BEFORE domain event insert.
   * The projection worker rebuilds inventory_truth after the domain
   * event is processed — movement must already be in the ledger.
   */
  if (externalInventoryItemGid && typeof payload.available === 'number') {
    try {
      const identityRow = await db('external_product_identity_map')
        .where({
          shop_id: shopId,
          external_inventory_item_id: externalInventoryItemGid,
        })
        .select('lasyncro_variant_id')
        .first();

      if (identityRow?.lasyncro_variant_id) {
        const locationCode = `WH-${shopId}-ROOT`;
        const currentTruth = await db('inventory_truth')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: identityRow.lasyncro_variant_id,
            location_code: locationCode,
          })
          .select('on_hand_quantity')
          .first();

        const currentOnHand = Number(currentTruth?.on_hand_quantity ?? 0);
        const shopifyAvailable = Number(payload.available);
        const delta = shopifyAvailable - currentOnHand;

        if (delta !== 0) {
          const { randomUUID } = await import('crypto');
          await db('inventory_movements')
            .insert({
              lasyncro_inventory_movement_id: randomUUID(),
              lasyncro_variant_id: identityRow.lasyncro_variant_id,
              shop_id: shopId,
              movement_type: 'reconciliation_correction',
              quantity_delta: delta,
              location_code: locationCode,
              reference_type: 'inventory_levels_update',
              reference_id: randomUUID(),
              occurred_at: eventTime,
              device_event_id: null,
              triggered_by: 'shopify_webhook', // traceability: Shopify inventory sync
            })
            .onConflict(['device_event_id'])
            .ignore();

          console.info('[INVENTORY_MOVEMENT_WRITTEN]', {
            lasyncro_variant_id: identityRow.lasyncro_variant_id,
            delta,
            currentOnHand,
            shopifyAvailable,
            eventId: envelope.eventId,
          });
        }
      }
    } catch (err) {
      console.error('[INVENTORY_MOVEMENT_WRITE_FAILED]', {
        error: (err as Error).message,
        eventId: envelope.eventId,
      });
    }
  }

  let domainEventId: number;
  try {
    const result = await db('domain_events')
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