// apps/backend/src/api/shopify/handlers/handleOrderCreated.ts
import type { Knex } from 'knex';
import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { buildExternalEventId } from '../../webhooks/buildExternalEventId.js';

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

// ISS-RLS2: trx is now REQUIRED — the router's caller passes its
// tenant-scoped transaction (SET LOCAL app.current_tenant already
// applied). All queries below use trx, never the bare db import,
// except the initial shopify_app_installations lookup which is a
// deliberate pre-tenant OAuth-path read (RLS_blueprint.md §4b) — see
// note at that call site.
export async function handleOrderCreated(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
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

  // OAuth-path table, split RLS policy — pre-tenant SELECT is
  // permitted (RLS_blueprint.md §4b). Uses trx anyway since we're
  // already inside the router's transaction; no functional difference
  // here, just consistency.
  const installation = await trx('shopify_app_installations')
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
   * ORDER VOLUME CAP ENFORCEMENT (MON-05)
   * --------------------------------------
   * Starter tier: 50 orders/month cap.
   * At 80% (40/50) → warn via console (alert system hook can be added here).
   * At 100% (50/50) → block ingestion hard.
   * Cap resets on calendar month boundary (COUNT filter by current month).
   * Falls back to 'starter' cap if no subscription row exists.
   */
  const { getTierConfig, isValidTier } = await import('@lasyncro/backend-core/config/tiers.js');

  const subRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');

  const rawTier = subRow?.tier ?? 'starter';
  const currentTier = isValidTier(rawTier) ? rawTier : 'starter';
  const { monthlyOrderCap } = getTierConfig(currentTier);

  if (isFinite(monthlyOrderCap)) {
    const usageRow = await trx('shop_usage_metrics')
      .where({ shop_id: shopId })
      .whereNull('period_ends_at')
      .first('ingested_orders');

    const monthlyCount = Number(usageRow?.ingested_orders ?? 0);

    if (monthlyCount >= monthlyOrderCap) {
      console.warn('[ORDER_CAP_HARD_BLOCK] Monthly order cap reached — ingestionblocked', {
        shopId,
        tier: currentTier,
        monthlyCount,
        monthlyOrderCap,
      });
      return;
    }

    const warningThreshold = Math.floor(monthlyOrderCap * 0.8);
    if (monthlyCount >= warningThreshold) {
      console.warn('[ORDER_CAP_APPROACHING] Shop approaching monthly order cap',{
        shopId,
        tier: currentTier,
        monthlyCount,
        monthlyOrderCap,
        warningThreshold,
      });
    }
  }

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

    const result = await trx('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: raw,
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

          return buildExternalEventId({
            source: 'webhook',
            integration: 'shopify',
            eventId: envelope.eventId,
          });
        })(),
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];

    // Increment ingested_orders on open billing period (MON-05)
    // Non-fatal — cap enforcement reads this value, not domain_events count.
    const usageUpdated = await trx('shop_usage_metrics')
      .where({ shop_id: shopId })
      .whereNull('period_ends_at')
      .increment('ingested_orders', 1);

    if (!usageUpdated) {
      console.warn('[ORDER_INGEST][USAGE] no open billing period — ingested_orders not incremented', { shopId });
    }

   /**
   * PAYMENT STATE NORMALIZATION
   * ----------------------------
   * Supports both REST and GraphQL payloads.
   * Uses safe access to avoid type violations.
   */
  const financialStatus =
    raw.financial_status?.toLowerCase() ??
    (raw as any).displayFinancialStatus?.toLowerCase();

  console.debug('[PAYMENT_STATE_DETECTED]', {
    financialStatus,
    hasFinancialStatus: !!raw.financial_status,
    hasDisplayFinancialStatus: !!(raw as any).displayFinancialStatus
  });

    if (financialStatus === 'paid') {

      const paidEvent = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'orders/paid',
          event_payload: {
            id: raw.id,
          },
          event_time: new Date(eventTime),
          event_version: 1,
          external_event_id: buildExternalEventId({
            source: 'webhook',
            integration: 'shopify',
            eventId: envelope.eventId,
            suffix: 'paid',
          }),
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
