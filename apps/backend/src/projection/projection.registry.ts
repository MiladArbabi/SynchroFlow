// apps/backend/src/projection/projection.registry.ts
import { Knex } from 'knex';

import { handleOrdersCreate } from './handlers/orders.create.js';
import { handleOrdersPaid } from './handlers/orders.paid.js';
import { handleOrdersShippingAddressCorrected } from './handlers/orders.shipping_address_corrected.js';
import { handleOrdersCanonicalDataRepaired } from './handlers/orders.canonical_data_repaired.js';
import { handleOrdersFulfilled } from './handlers/orders.fulfilled.js';
import { handleRefundsCreate } from './handlers/refunds.create.js';
import { handleLifecycleFT0Completed } from './handlers/lifecycle.ft0_completed.js';
import { handleLifecycleFT2Confirmed } from './handlers/lifecycle.ft2_confirmed.js';
import { handleLifecycleFirstInsightDelivered } from './handlers/lifecycle.first_insight_delivered.js';
import { handleIntegrationSyncRequested } from './handlers/integration.sync_requested.js';
import { handleReconciliationIntentCaptured } from './handlers/reconciliation.intentCaptured.js';
import { handleOrdersSyncStarted } from './handlers/orders.sync_started.js';
import { rebuildInventoryProjectionForVariants } from '../services/inventory/rebuildInventoryProjection.js';
import { handleCatalogProductSyncReceived } from './handlers/catalog.product_sync_received.js';
import { handleOrdersConstraintsReevaluated } from './handlers/orders.constraints_reevaluated.js';

/**
 * PROJECTION HANDLER CONTRACT
 * ---------------------------
 * All handlers execute inside the projection engine transaction.
 * trx is injected by projection.engine to guarantee:
 *
 * - atomic projection updates
 * - deterministic replay
 * - consistent cursor advancement
 */
export type ProjectionHandler = (params: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) => Promise<void>;

/**
 * EVENT NORMALIZATION
 * -------------------
 * Shopify historical ingestion produces `orders/sync`
 * while live webhooks produce `orders/create`.
 *
 * Both represent the same semantic event and must
 * be projected through the same handler to preserve
 * deterministic rebuild guarantees.
 */
export const projectionRegistry: Record<string, ProjectionHandler> = {
  'orders/create': handleOrdersCreate,
  'orders/sync': handleOrdersCreate,
  'orders/sync_started': handleOrdersSyncStarted,
  'integration/sync_requested': handleIntegrationSyncRequested,
  'orders/paid': handleOrdersPaid,
  /**
   * SHIPPING ADDRESS CORRECTED (GH-1036, 2026-07-02)
   * ---------------------------------------------------
   * See orders.shipping_address_corrected.ts's header for full context.
   * The write already happened directly in
   * orders.shipping-address.controller.ts — this event's sole purpose
   * is to be a real, valid domain event that flows through
   * projectDomainEventCore's constraint/risk orchestration (requires
   * being in the isOrderEntityEvent list too — see projection.engine.ts).
   */
  'orders/shipping_address_corrected': handleOrdersShippingAddressCorrected,

  /**
   * SHOPIFY-CANON-REST-02
   * ---------------------
   * Historical canonical repair writes canonical data first, then emits
   * this event so the standard order projection orchestration re-evaluates
   * constraints and risk from the repaired state.
   */
  'orders/canonical_data_repaired': handleOrdersCanonicalDataRepaired,
  /**
   * BL-01a
   * ------
   * Pure re-evaluation trigger. Emitted for orders whose constraints were
   * written by a superseded evaluator and which receive no further events.
   * No mutation — see the handler header.
   */
  'orders/constraints_reevaluated': handleOrdersConstraintsReevaluated,
  'orders/fulfilled': handleOrdersFulfilled,
  'orders/fulfillment_updated': async (params) => {
  /**
   * HANDLER CONTRACT GUARD (CRITICAL)
   * ---------------------------------
   * Ensures fulfillment events always arrive normalized.
   *
   * Prevents:
   * - raw payload leakage
   * - schema drift across event variants
   */
    if (!(params.domainEvent as any).canonical_payload) {
      console.error('[PROJECTION_CONTRACT_VIOLATION][MISSING_CANONICAL]', {
        eventType: params.domainEvent.event_type,
        eventId: params.domain_event_id,
      });

      throw new Error(
        '[PROJECTION_CONTRACT_VIOLATION] canonical_payload missing'
      );
    }

    return handleOrdersFulfilled(params);
  },
  'refunds/create': handleRefundsCreate,
  /**
   * INVENTORY LEVEL UPDATES
   * -----------------------
   * Shopify inventory webhooks enter the domain event log
   * but inventory truth is currently derived from
   * reconciliation + inventory projection rebuild.
   *
   * This handler intentionally performs no mutation.
   *
   * Purpose:
   * - prevent silent projection drop
   * - provide operational visibility
   * - preserve deterministic replay behavior
   */
  'inventory_levels/update': async ({ domainEvent, trx, canonicalEventTime }) => {
    console.info('[PROJECTION_INVENTORY_EVENT_OBSERVED]', {
      shopId: domainEvent.shop_id,
      eventId: domainEvent.id,
    });

    /**
     * INVENTORY TRUTH REBUILD ON WEBHOOK
     * ------------------------------------------
     * Resolves Shopify inventory_item_id → lasyncro_variant_id
     * via external_product_identity_map, then rebuilds
     * inventory_truth for the affected variant only.
     *
     * This keeps inventory_truth current after initial sync
     * without requiring a full shop rebuild.
     *
     * Identity path:
     * event_payload.inventory_item_id
     *   → external_product_identity_map.external_inventory_item_id
     *   → external_variant_id
     *   → variants.lasyncro_variant_id
     */
    const payload = domainEvent.event_payload as {
      inventory_item_id?: number;
      admin_graphql_api_id?: string;
    };

    /**
     * GID RESOLUTION (CRITICAL FIX — IN-02)
     * --------------------------------------
     * Shopify inventory_levels/update webhook sends:
     *   admin_graphql_api_id: "gid://shopify/InventoryLevel/xxx?inventory_item_id=yyy"
     *
     * external_product_identity_map stores clean InventoryItem GIDs:
     *   "gid://shopify/InventoryItem/yyy"
     *
     * Must extract inventory_item_id from query string and reconstruct.
     * Fallback to payload.inventory_item_id if present.
     */
    let externalInventoryItemGid: string | null = null;

    if (payload?.admin_graphql_api_id) {
      const url = new URL(payload.admin_graphql_api_id.replace('gid://', 'https://gid/'));
      const inventoryItemId = url.searchParams.get('inventory_item_id');
      if (inventoryItemId) {
        externalInventoryItemGid = `gid://shopify/InventoryItem/${inventoryItemId}`;
      }
    }

    if (!externalInventoryItemGid && payload?.inventory_item_id) {
      externalInventoryItemGid = `gid://shopify/InventoryItem/${payload.inventory_item_id}`;
    }

    if (!externalInventoryItemGid) {
      console.warn('[INVENTORY_PROJECTION_SKIP_NO_IDENTITY]', {
        eventId: domainEvent.id,
      });
      return;
    }

    /**
     * Resolve external inventory item → internal variant
     */
    const identityRow = await trx('external_product_identity_map')
      .where({
        shop_id: domainEvent.shop_id,
        external_inventory_item_id: externalInventoryItemGid,
      })
      .select('external_variant_id', 'lasyncro_variant_id')
      .first();

    if (!identityRow?.external_variant_id) {
      console.warn('[INVENTORY_PROJECTION_SKIP_NO_VARIANT]', {
        eventId: domainEvent.id,
        externalInventoryItemGid,
      });
      return;
    }

    /**
     * DIRECT RESOLUTION (CANONICAL)
     * ------------------------------
     * lasyncro_variant_id lives directly on external_product_identity_map.
     * No join to variants table required.
     *
     * Identity path confirmed:
     * external_inventory_item_id → lasyncro_variant_id (single row lookup)
     */
    if (!identityRow?.lasyncro_variant_id) {
      console.warn('[INVENTORY_PROJECTION_SKIP_NO_LASYNCRO_VARIANT]', {
        eventId: domainEvent.id,
        externalInventoryItemGid,
      });
      return;
    }

    await rebuildInventoryProjectionForVariants(
      domainEvent.shop_id,
      [identityRow.lasyncro_variant_id],
      trx,
      canonicalEventTime
    );

    console.info('[INVENTORY_TRUTH_REBUILT]', {
      shopId: domainEvent.shop_id,
      variantId: identityRow.lasyncro_variant_id,
      eventId: domainEvent.id,
    });
  },

  /**
   * FT0 COMPLETION (v2)
   * -------------------
   * Domain event renamed from lifecycle/ft0_completed → ft0.completed
   *
   * Reason:
   * - lifecycle namespace is reserved for projection outputs only
   * - services emit domain events only
   */
  'ft0/completed': handleLifecycleFT0Completed,
  'lifecycle/ft2_confirmed': handleLifecycleFT2Confirmed,
  'lifecycle/first_insight_delivered': handleLifecycleFirstInsightDelivered,
  /**
   * PRODUCT SYNC EVENTS (CRITICAL)
   * ------------------------------
   * Ensures product ingestion events are not silently dropped.
   *
   * Current behavior:
   * - Events are emitted by ingestion worker
   * - No projection handler → system blindness
   *
   * This handler is intentionally no-op until
   * product projection layer is defined.
   */
  'catalog/product_sync_received': handleCatalogProductSyncReceived,
  'reconciliation/intent_captured': handleReconciliationIntentCaptured,
  /**
   * RETURNS — REQUESTED (INTENTIONAL NO-OP)
   * ----------------------------------------
   * Shopify fires returns/requested before a refund is issued.
   * LaSyncro projects returns exclusively via refunds/create,
   * which carries the authoritative financial event.
   *
   * This handler prevents silent projection drop.
   * No mutation is performed — refunds/create is the canonical path.
   */
  'returns/requested': async ({ domainEvent }) => {
    console.info('[PROJECTION_RETURN_REQUESTED_OBSERVED]', {
      shopId: domainEvent.shop_id,
      eventId: domainEvent.id,
    });
  },
};