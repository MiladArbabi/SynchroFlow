// apps/backend/src/projection/handlers/orders.create.ts
import crypto from 'crypto';
import { Knex } from 'knex';

import { FirstInsightService } from '../../services/first-insight.service.js';

/**
 * REVENUE UNIT MATERIALIZATION
 * ----------------------------
 * Revenue units represent immutable economic atoms
 * derived from order_line_items.
 *
 * They MUST be created at order creation time,
 * not at fulfillment.
 */
import { writeOrderRevenueUnits } from '../../workers/reconciliation/revenue-units.writer.js';
import { debugLog } from '../projection.utils.js';
import { evaluateAlertRulesForOrder } from '../../services/alerts/alertRules.service.js';

const ORDER_UUID_NAMESPACE =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export async function handleOrdersCreate({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {

  const traceId = domainEvent.event_payload?.trace_id;

  debugLog('[ORDER_INGESTION_TRACE]', {
    eventId: domain_event_id,
    shopId: domainEvent.shop_id,
    traceId,
  });

  debugLog('[ORDER_HANDLER_ENTER]', {
    eventId: domain_event_id,
    eventType: domainEvent.event_type,
  });

  /**
   * 🚀 FT0 ENTRY — INGESTION-DRIVEN (CANONICAL)
   * -------------------------------------------
   * First real data ingestion marks FT0.
   *
   * Guarantees:
   * - deterministic (domain event driven)
   * - replay safe
   * - single authority (no integration coupling)
   */
  const shopId = domainEvent.shop_id;

  const existingSnapshot = await trx('user_lifecycle_snapshot')
    .where({ shop_id: shopId })
    .first('phase');

  if (!existingSnapshot) {
    const { LifecycleTransitionService } = await import(
      '../../services/lifecycle-transition.service.js'
    );

    const foundingOwner = await trx('shop_memberships')
      .where({ shop_id: shopId, role: 'owner' })
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .first<{ user_id: number }>('user_id');

    if (!foundingOwner?.user_id) {
      throw new Error(`LIFECYCLE_FOUNDING_OWNER_MISSING: shopId=${shopId}`);
    }

    await LifecycleTransitionService.auditIfTransitioned(
      {
        // Lifecycle is shop-scoped but permanently anchored to the founding owner.
        userId: foundingOwner.user_id,
        shopId,
        currentPhase: 'FT0',
      },
      trx
    );

    debugLog('[FT0_ENTRY_FROM_INGESTION]', {
      shopId,
      userId: foundingOwner.user_id,
    });
  }

  /**
   * CANONICAL PAYLOAD SWITCH
   * ------------------------
   * Prefer canonical payload when available.
   * Fallback to raw for backward compatibility.
   */
  const payload =
    (domainEvent as any).canonical_payload ??
    domainEvent.event_payload;

  /**
   * PAYMENT STATE (SOURCE OF TRUTH FIX)
   * -----------------------------------
   * orders/create MUST NOT infer payment.
   * Payment truth is established ONLY via:
   * - orders/paid event
   */
  const paymentState = 'unpaid';

  /**
   * UNIFIED ORDER ID RESOLUTION (CRITICAL FIX)
   * ------------------------------------------
   * Supports multiple event schemas:
   * - orders/create, orders/sync → payload.id
   * - orders/fulfilled → payload.order_id
   * - future-proof against schema drift
   *
   * Guarantees:
   * - no identity collapse
   * - consistent hashing across event types
   */
  const rawId =
    (domainEvent as any).canonical_payload?.id ??
    domainEvent.event_payload?.id ??
    domainEvent.event_payload?.order_id;

  if (!rawId) {
    console.error('[ORDER_ID_RESOLUTION_FAILED]', {
      eventId: domain_event_id,
      eventType: domainEvent.event_type,
      payload: domainEvent.event_payload,
    });
    throw new Error('[ORDER_ID_MISSING]');
  }

  let externalOrderId = String(rawId);

  debugLog('[ORDER_ID_TRACE]', {
    eventId: domain_event_id,
    eventType: domainEvent.event_type,
    rawId,
    externalOrderId,
  });

  if (domainEvent.event_payload?.order_id && !domainEvent.event_payload?.id) {
    debugLog('[ORDER_ID_FALLBACK_USED]', {
      eventType: domainEvent.event_type,
      used: 'order_id',
      eventId: domain_event_id,
    });
  }

  if (externalOrderId.startsWith('gid://')) {
    const parts = externalOrderId.split('/');
    externalOrderId = parts[parts.length - 1];
  }

  if (!/^\d+$/.test(externalOrderId)) {
    throw new Error(
      `[IDENTITY_CANONICAL_VIOLATION] Invalid Shopify Order ID: ${externalOrderId}`
    );
  };

  const lasyncroOrderId = crypto
    .createHash('sha1')
    .update(
      `${ORDER_UUID_NAMESPACE}:${domainEvent.shop_id}:shopify:${externalOrderId}`
    )
    .digest('hex')
    .slice(0, 32)
    .replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      '$1-$2-$3-$4-$5'
    );

  debugLog('[ORDER_HASH_TRACE]', {
    eventId: domain_event_id,
    externalOrderId,
    lasyncroOrderId,
  });

  const existingOrder = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  debugLog('[ORDER_EXISTENCE_CHECK]', {
    eventId: domain_event_id,
    lasyncroOrderId,
    exists: !!existingOrder,
  });

  if (existingOrder) {
      console.warn('[ORDER_DUPLICATE_DETECTED]', {
        lasyncroOrderId,
        externalOrderId,
        eventId: domain_event_id,
      });
      // Update shipping fields on re-projection — captures data
      // added after initial sync (WM-34: invoice PDF generation).
      await trx('orders')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .update({
          shipping_name: payload.shippingAddress?.name ?? payload.shipping_address?.name ?? null,
          shipping_address1: payload.shippingAddress?.address1 ?? payload.shipping_address?.address1 ?? null,
          shipping_address2: payload.shippingAddress?.address2 ?? payload.shipping_address?.address2 ?? null,
          shipping_city: payload.shippingAddress?.city ?? payload.shipping_address?.city ?? null,
          shipping_zip: payload.shippingAddress?.zip ?? payload.shipping_address?.zip ?? null,
          shipping_phone: payload.shippingAddress?.phone ?? payload.shipping_address?.phone ?? null,
          shipping_province: payload.shippingAddress?.provinceCode ?? payload.shipping_address?.province_code ?? null,
          shipping_country_code: payload.shippingAddress?.countryCode ?? payload.shipping_address?.country_code ?? null,
          updated_at: new Date(),
        });
    }

  if (!existingOrder) {

    /**
     * CURRENCY INVARIANT ENFORCEMENT
     * ------------------------------
     * Currency is a non-null domain invariant.
     * Must be resolved BEFORE persistence.
     */
    const currency =
      payload.currency ?? payload.currencyCode;

    if (!currency) {
      throw new Error('[ORDERS_CREATE] Currency missing from both canonical and raw');
    }

    const totalPrice =
      payload.totalPrice ??
      (payload.totalPriceSet?.shopMoney?.amount != null
        ? Number(payload.totalPriceSet.shopMoney.amount)
        : payload.total_price);

    if (totalPrice == null) {
      throw new Error('[ORDERS_CREATE] total_price is required');
    }

    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: domainEvent.shop_id,
      /**
       * CURRENCY RESOLUTION (CANONICAL-FIRST)
       */
      currency,
      total_price: totalPrice,
      /**
       * SUBTOTAL RESOLUTION (CANONICAL-FIRST)
       */
      subtotal_price:
        payload.subtotalPrice ??
        (payload.subtotalPriceSet?.shopMoney?.amount != null
          ? Number(payload.subtotalPriceSet.shopMoney.amount)
          : null),

      total_tax:
        payload.totalTax ??
        (payload.totalTaxSet?.shopMoney?.amount != null
          ? Number(payload.totalTaxSet.shopMoney.amount)
          : null),

      order_created_at: canonicalEventTime,
      order_updated_at: canonicalEventTime,
      payment_state: paymentState,
      aggregate_version: 1,
      /**
       * CUSTOMER IDENTITY (CL-INF-01 FIX)
       * -----------------------------------
       * Populated from canonical payload customer.hashedId.
       * Null for guest checkouts — expected and allowed.
       */
      customer_hashed_id: payload.customer?.hashedId ?? null,
      /**
       * SHIPPING REGION (PP3-04)
       * -------------------------
       * Supports both REST and GraphQL Shopify payloads.
       * REST:    shipping_address.province_code / country_code
       * GraphQL: shippingAddress.provinceCode / countryCode
       *
       * Used by shop_alert_rules.rule_type = 'order_from_region'
       * to fire per-order region alerts.
       */
      shipping_province:
        payload.shippingAddress?.provinceCode ??
        payload.shipping_address?.province_code ??
        null,
      shipping_country_code:
        payload.shippingAddress?.countryCode ??
        payload.shipping_address?.country_code ??
        null,

      /**
       * FULL SHIPPING ADDRESS (WM-34)
       * ------------------------------
       * Captured for invoice PDF generation.
       * Supports both REST and GraphQL Shopify payloads.
       * All nullable — digital/gift card orders have no shipping address.
       */
      shipping_name:
        payload.shippingAddress?.name ??
        payload.shipping_address?.name ??
        null,
      shipping_address1:
        payload.shippingAddress?.address1 ??
        payload.shipping_address?.address1 ??
        null,
      shipping_address2:
        payload.shippingAddress?.address2 ??
        payload.shipping_address?.address2 ??
        null,
      shipping_city:
        payload.shippingAddress?.city ??
        payload.shipping_address?.city ??
        null,
      shipping_zip:
        payload.shippingAddress?.zip ??
        payload.shipping_address?.zip ??
        null,
      shipping_phone:
        payload.shippingAddress?.phone ??
        payload.shipping_address?.phone ??
        null,

      created_at: canonicalEventTime,
      updated_at: canonicalEventTime,
    })
    .onConflict('lasyncro_order_id')
    .merge({
      // Update shipping address fields on re-projection — captures data
      // added after initial sync (WM-34: invoice PDF generation).
      shipping_name: payload.shippingAddress?.name ?? payload.shipping_address?.name ?? null,
      shipping_address1: payload.shippingAddress?.address1 ?? payload.shipping_address?.address1 ?? null,
      shipping_address2: payload.shippingAddress?.address2 ?? payload.shipping_address?.address2 ?? null,
      shipping_city: payload.shippingAddress?.city ?? payload.shipping_address?.city ?? null,
      shipping_zip: payload.shippingAddress?.zip ?? payload.shipping_address?.zip ?? null,
      shipping_phone: payload.shippingAddress?.phone ?? payload.shipping_address?.phone ?? null,
      shipping_province: payload.shippingAddress?.provinceCode ?? payload.shipping_address?.province_code ?? null,
      shipping_country_code: payload.shippingAddress?.countryCode ?? payload.shipping_address?.country_code ?? null,
      updated_at: canonicalEventTime,
    });
    debugLog('[ORDER_INSERTED]', { lasyncroOrderId });

    /**
     * ALERT RULES EVALUATION (PP3-01, PP3-02)
     * ----------------------------------------
     * Evaluates shop_alert_rules against the new order.
     * Non-blocking — errors logged, never thrown.
     * Runs inside the same transaction for atomicity.
     */
    await evaluateAlertRulesForOrder(trx, {
      lasyncroOrderId,
      shopId: domainEvent.shop_id,
      totalPrice: totalPrice ?? 0,
      shippingProvince:
        payload.shippingAddress?.provinceCode ??
        payload.shipping_address?.province_code ??
        null,
      shippingCountryCode:
        payload.shippingAddress?.countryCode ??
        payload.shipping_address?.country_code ??
        null,
    });

    /**
     * CUSTOMER UPSERT
     * ---------------------------------
     * When a registered customer order arrives, upsert a customer record.
     * Uses external_customer_id = hashed Shopify customer ID.
     * Idempotent — safe on replay.
     * Guest checkouts (no customer) are silently skipped.
     */
    if (payload.customer?.hashedId) {
      await trx('customers')
        .insert({
          shop_id: domainEvent.shop_id,
          external_customer_id: payload.customer.hashedId,
          created_at: canonicalEventTime,
          updated_at: canonicalEventTime,
        })
        .onConflict(['shop_id', 'external_customer_id'])
        .ignore();

      debugLog('[CUSTOMER_UPSERTED]', {
        hashedId: payload.customer.hashedId,
        orderId: lasyncroOrderId,
      });
    }

    const tenantCheck = await trx.raw(
      `SELECT current_setting('app.current_tenant', true) as tenant`
    );

    debugLog('[RLS_TENANT_CHECK]', tenantCheck.rows[0]);

    await trx('external_order_identity_map')
      .insert({
        lasyncro_order_id: lasyncroOrderId,
        shop_id: domainEvent.shop_id,
        platform: 'shopify',
        external_order_id: externalOrderId,
      })
      /**
       * CONFLICT STRATEGY: MERGE (ORDER IDENTITY)
       * ----------------------------------------
       * Prevents silent drop on duplicate external order.
       * Ensures deterministic replay and idempotent ingestion.
       */
      .onConflict(['shop_id', 'platform', 'external_order_id'])
      .merge({
        updated_at: trx.fn.now()
      });

    /**
     * LINE ITEM INSERT (NEW ORDERS ONLY)
     * -----------------------------------
     * Full insert with all fields.
     * Runs only when order is new.
     * Replay safety for existing orders handled by the
     * unconditional update loop below.
     */
    const lineEdges = Array.isArray(payload.lineItems)
      ? payload.lineItems
      : payload.lineItems?.edges
      ?? payload.line_items
      ?? [];

    for (const edge of lineEdges) {
      const li = edge.node ?? edge;
      let variantGid = li.variant?.id ?? li.variantId ?? li.variant_id ?? null;
      if (!variantGid) continue;
      variantGid = String(variantGid);
      const variantId = variantGid.startsWith('gid://')
        ? variantGid
        : `gid://shopify/ProductVariant/${variantGid}`;

      const variantIdentity = await trx('external_product_identity_map')
        .where({ shop_id: domainEvent.shop_id, platform: 'shopify', external_variant_id: variantId })
        .first();

      if (!variantIdentity) {
        throw new Error(
          `[ORDER_LINE_ITEM_VARIANT_IDENTITY_MISSING] shopId=${domainEvent.shop_id} order=${externalOrderId} variant=${variantId}`
        );
      }

      const variantRow = await trx('variants')
        .where({ lasyncro_variant_id: variantIdentity.lasyncro_variant_id })
        .first();

      if (!variantRow) {
        throw new Error(
          `[ORDER_LINE_ITEM_VARIANT_ROW_MISSING] shopId=${domainEvent.shop_id} order=${externalOrderId} variant=${variantId}`
        );
      }

      const quantity = li.quantity ?? 0;
      const unitPrice =
        li.unitPrice != null ? Number(li.unitPrice)
        : li.originalUnitPriceSet?.shopMoney?.amount != null ? Number(li.originalUnitPriceSet.shopMoney.amount)
        : li.price != null ? Number(li.price)
        : 0;

      // Canonical payload uses lineItemId; raw GraphQL uses id
      const lineItemId = li.lineItemId ?? li.id;
      await trx('order_line_items')
        .insert({
          lasyncro_line_item_id: crypto
            .createHash('sha1')
            .update(`${ORDER_UUID_NAMESPACE}:${domainEvent.shop_id}:shopify:${externalOrderId}:line:${lineItemId}`)
            .digest('hex').slice(0, 32)
            .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'),
          lasyncro_order_id: lasyncroOrderId,
          lasyncro_product_id: variantRow.lasyncro_product_id,
          lasyncro_variant_id: variantIdentity.lasyncro_variant_id,
          title: variantRow.title ?? li.variant?.title ?? li.title ?? '',
          sku: li.sku ?? variantRow.sku ?? null,
          quantity,
          unit_price: unitPrice,
          line_total: unitPrice * quantity,
          platform: 'shopify',
          external_line_item_id: lineItemId,
          created_at: canonicalEventTime,
          updated_at: canonicalEventTime,
        })
        .onConflict('lasyncro_line_item_id')
        .merge({ external_line_item_id: lineItemId, updated_at: trx.fn.now() });

        debugLog('[ORDER_LINE_ITEM_INSERT_SUCCESS]', { externalLineItemId: lineItemId });
    }
  } // end if (!existingOrder)

  /**
   * LINE ITEM EXTERNAL ID BACKFILL (REPLAY-SAFE)
   * ---------------------------------------------
   * Runs for both new and existing orders.
   * Ensures external_line_item_id is always populated
   * even when order already existed at projection time.
   * Idempotent — onConflict merge handles duplicates.
   */
  const lineEdgesForUpdate = Array.isArray(payload.lineItems)
    ? payload.lineItems
    : payload.lineItems?.edges
    ?? payload.line_items
    ?? [];

  for (const edge of lineEdgesForUpdate) {
    const li = edge.node ?? edge;
    const lineItemId = li.lineItemId ?? li.id;
    if (!lineItemId) continue;

    let variantGid = li.variant?.id ?? li.variantId ?? li.variant_id ?? null;
    if (!variantGid) continue;
    variantGid = String(variantGid);
    const variantId = variantGid.startsWith('gid://')
      ? variantGid
      : `gid://shopify/ProductVariant/${variantGid}`;

    const variantIdentity = await trx('external_product_identity_map')
      .where({ shop_id: domainEvent.shop_id, platform: 'shopify', external_variant_id: variantId })
      .first();

    if (!variantIdentity) continue;

    await trx('order_line_items')
      .where({
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_variant_id: variantIdentity.lasyncro_variant_id,
      })
      .update({
        external_line_item_id: lineItemId,
        updated_at: canonicalEventTime,
      });
  }

    let baselineStatus:
      | 'pending'
      | 'processing'
      | 'fulfilled'
      | 'partially_fulfilled'
      | 'cancelled'
      | 'failed' = 'pending';

    /**
     * FULFILLMENT SOURCE NORMALIZATION
     * --------------------------------
     * Shopify GraphQL + REST mismatch:
     *
     * Possible fields:
     * - displayFulfillmentStatus (GraphQL)
     * - fulfillment_status (REST)
     * - fulfillmentStatus (GraphQL alt)
     */
    const snapshotStatus =
      payload.displayFulfillmentStatus ??
      payload.fulfillmentStatus ??
      payload.fulfillment_status ??
      null;

    const normalizedStatus =
      typeof snapshotStatus === 'string'
        ? snapshotStatus.toLowerCase()
        : null;

    switch (normalizedStatus) {
      case 'fulfilled':
        baselineStatus = 'fulfilled';
        break;

      case 'partial':
      case 'partially_fulfilled':
        baselineStatus = 'partially_fulfilled';
        break;

      case 'unfulfilled':
      case 'null':
        baselineStatus = 'pending';
        break;

      case 'cancelled':
        baselineStatus = 'cancelled';
        break;

      default:
        baselineStatus = 'pending';
    }

    /**
     * INITIAL FULFILLMENT STATE PROJECTION
     * -------------------------------------
     * Derived directly from order creation event.
     * No external service calls allowed.
     */
    await trx('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending',
        status_updated_at: new Date(domainEvent.event_time),
        fulfilled_at: null,
      })
      /**
       * CONFLICT STRATEGY: MERGE (CANONICAL ORDER)
       * -----------------------------------------
       * Ensures order row is always up-to-date.
       * Prevents silent drops and guarantees deterministic replay.
       */
      .onConflict('lasyncro_order_id')
      .merge({
        updated_at: trx.fn.now()
      });

    /**
     * PROJECTION TRACE
     */
    /* debugLog('[FULFILLMENT_PROJECTED_INITIAL]', {
      lasyncroOrderId,
    }); */

  try {
    await writeOrderRevenueUnits(lasyncroOrderId, trx);
  } catch (err: any) {

      /**
       * REVENUE UNIT FAILURE IS NON-FATAL
       * ---------------------------------
       * Must NOT break order projection.
       * Revenue can be rebuilt later.
       */
      console.error('[ORDER_REVENUE_UNITS_FAILED]', {
        lasyncroOrderId,
        error: err?.message ?? err,
      });
    }

  const orderRow = await trx('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select('aggregate_version')
    .first();

  if (!orderRow) {
    /**
     * INVARIANT VIOLATION (FATAL)
     * ---------------------------
     * Order row must exist after insert.
     * Silent continuation here causes an immediate null dereference
     * on orderRow.aggregate_version below — crash is guaranteed.
     *
     * Throwing surfaces the real failure and preserves transaction
     * rollback semantics (event will be retried deterministically).
     */
    console.error('[ORDER_VERSION_MISSING_AFTER_CREATE_FATAL]', {
      lasyncroOrderId,
      shopId: domainEvent.shop_id,
    });
    throw new Error(`[ORDER_VERSION_MISSING_AFTER_CREATE] order=${lasyncroOrderId}`);
  }

  /**
   * RECONCILIATION INTENT CAPTURE (REBUILD SAFE)
   */
  await trx('order_reconciliation_intents')
    .insert({
      lasyncro_order_id: lasyncroOrderId,
      aggregate_version: orderRow.aggregate_version,
      // THREAD A-2 (2026-06-29): shop_id added to this table's base
      // migration (0037) for the new tenant-isolation RLS policy.
      // Required on every insert now — WITH CHECK fails on NULL.
      shop_id: domainEvent.shop_id,
      observed: JSON.stringify({
        observedAt: domainEvent.event_time,
        source: domainEvent.event_type
      }),
      created_at: domainEvent.event_time
    })
    /**
     * CONFLICT STRATEGY: MERGE (EVENT VERSIONING)
     * ------------------------------------------
     * Prevents loss of versioned order events.
     * Ensures idempotent replay and consistent event history.
     */
    .onConflict(['lasyncro_order_id', 'aggregate_version'])
    .merge({
      updated_at: trx.fn.now()
    });

  const countRow = await trx('orders')
    .where({ shop_id: domainEvent.shop_id })
    .count<{ count: string }>('* as count')
    .first();

  const currentCount = Number(countRow?.count ?? 0);

  if (currentCount >= 1) {
    /**
     * POST-COMMIT SIDE EFFECT (CRITICAL)
     * -----------------------------------
     * FirstInsightService.computeAndPersist uses its own DB connection
     * and cannot participate in the projection transaction.
     *
     * Calling it inside the transaction risks:
     * - reading uncommitted order data (sees 0 orders)
     * - firing on a transaction that later rolls back
     *
     * Chaining onto trx.executionPromise ensures:
     * - fires only after commit
     * - order row is visible to the service's own DB read
     */
    const shopIdSnapshot = domainEvent.shop_id;
    trx.executionPromise.then(async () => {
      try {
        await FirstInsightService.computeAndPersist(shopIdSnapshot);
      } catch (err) {
        // Non-fatal: insight delivery can be retried independently.
        console.error('[FIRST_INSIGHT_POST_COMMIT_FAILED]', {
          shopId: shopIdSnapshot,
          error: err,
        });
      }
    });
  }
}