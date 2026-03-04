// apps/backend/src/projection/handlers/orders.create.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { Knex } from 'knex';

import OrderFulfillmentIngestionService from '../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { FirstInsightService } from '../../services/first-insight.service.js';
import { FT0CompletionService } from '../../services/ft0-completion.service.js';
import { advanceCursor } from '../projection.engine.js';

const ORDER_UUID_NAMESPACE =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleOrdersCreate({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
}) {

  console.log('[ORDERS_SYNC][FT0_CHECK_TRIGGER]', {
    shopId: domainEvent.shop_id,
  });

  const payload = domainEvent.event_payload as any;

  let externalOrderId = String(payload.id);

  if (externalOrderId.startsWith('gid://')) {
    const parts = externalOrderId.split('/');
    externalOrderId = parts[parts.length - 1];
  }

  if (!/^\d+$/.test(externalOrderId)) {
    throw new Error(
      `[IDENTITY_CANONICAL_VIOLATION] Invalid Shopify Order ID: ${externalOrderId}`
    );
  }

  await db.transaction(async (trx: Knex.Transaction) => {

    const cursorRow = await trx('projection_cursors')
      .where({ projection_name: ORDERS_PROJECTION })
      .forUpdate()
      .first<{ last_processed_event_id: number }>();

    if (
      cursorRow?.last_processed_event_id != null &&
      domain_event_id <= cursorRow.last_processed_event_id
    ) {
      console.warn('[PROJECTION_DUPLICATE_EVENT_IGNORED]', {
        last: cursorRow.last_processed_event_id,
        received: domain_event_id,
      });
      return;
    }

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

    const existingOrder = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!existingOrder) {

      await trx('orders').insert({
        lasyncro_order_id: lasyncroOrderId,
        shop_id: domainEvent.shop_id,
        currency: payload.currencyCode ?? payload.currency ?? null,
        total_price:
          payload.totalPriceSet?.shopMoney?.amount != null
            ? Number(payload.totalPriceSet.shopMoney.amount)
            : payload.total_price ?? null,
        subtotal_price:
          payload.subtotalPriceSet?.shopMoney?.amount != null
            ? Number(payload.subtotalPriceSet.shopMoney.amount)
            : payload.subtotal_price ?? null,
        total_tax:
          payload.totalTaxSet?.shopMoney?.amount != null
            ? Number(payload.totalTaxSet.shopMoney.amount)
            : payload.total_tax ?? null,
        order_created_at: canonicalEventTime,
        order_updated_at: canonicalEventTime,
        payment_state: 'unpaid',
        aggregate_version: 1,
        created_at: canonicalEventTime,
        updated_at: canonicalEventTime,
      });

      await trx('external_order_identity_map')
        .insert({
          lasyncro_order_id: lasyncroOrderId,
          shop_id: domainEvent.shop_id,
          platform: 'shopify',
          external_order_id: externalOrderId,
        })
        .onConflict(['shop_id', 'platform', 'external_order_id'])
        .ignore();

      if (domainEvent.event_type === 'orders/sync') {

        const snapshotStatus = payload.displayFulfillmentStatus;

        let baselineStatus:
          | 'pending'
          | 'processing'
          | 'fulfilled'
          | 'partially_fulfilled'
          | 'cancelled'
          | 'failed' = 'pending';

        switch (snapshotStatus) {
          case 'FULFILLED':
            baselineStatus = 'fulfilled';
            break;
          case 'PARTIALLY_FULFILLED':
            baselineStatus = 'partially_fulfilled';
            break;
          case 'UNFULFILLED':
            baselineStatus = 'pending';
            break;
          case 'CANCELLED':
            baselineStatus = 'cancelled';
            break;
        }

        await OrderFulfillmentIngestionService.ingestStatus(
          {
            lasyncroOrderId,
            status: baselineStatus,
            canonicalEventTime: new Date(domainEvent.event_time),
          },
          trx
        );

        /**
         * SYNC RECONCILIATION TRIGGER
         * ---------------------------
         * Shopify sync delivers snapshot fulfillment state.
         *
         * The reconciliation pipeline historically relied on
         * the `orders/fulfilled` domain event, but during
         * snapshot ingestion we may already observe fulfilled
         * orders.
         *
         * To maintain projection completeness, we emit a
         * reconciliation intent when the snapshot status
         * indicates fulfillment.
         *
         * This guarantees the following pipeline executes:
         *
         * orders/sync
         *   → reconciliation intent
         *   → reconciliation worker
         *   → revenue unit materialization
         *   → operational control snapshot
         *
         * Determinism:
         * - aggregate_version used as reconciliation version
         * - no wall-clock timestamps used for domain logic
         */

        if (baselineStatus === 'fulfilled') {

          const orderRow = await trx('orders')
            .where({ lasyncro_order_id: lasyncroOrderId })
            .select('aggregate_version')
            .first();

          if (!orderRow) {
            throw new Error('[ORDER_VERSION_MISSING_FOR_RECONCILIATION]');
          }

          await trx('order_reconciliation_intents')
            .insert({
              lasyncro_order_id: lasyncroOrderId,
              aggregate_version: orderRow.aggregate_version,
              observed: JSON.stringify({
                status: 'fulfilled',
                observedAt: domainEvent.event_time,
                source: 'shopify_sync'
              }),
              created_at: domainEvent.event_time
            })
            .onConflict(['lasyncro_order_id', 'aggregate_version'])
            .ignore();

        }
      }

      const lineEdges =
        payload.lineItems?.edges ??
        payload.line_items ??
        [];

      for (const edge of lineEdges) {

        const li = edge.node ?? edge;

        let variantGid = li.variant?.id ?? li.variant_id ?? null;
        if (!variantGid) continue;

        variantGid = String(variantGid);

        const variantId = variantGid.startsWith('gid://')
          ? variantGid
          : `gid://shopify/ProductVariant/${variantGid}`;

        const variantIdentity = await trx('external_product_identity_map')
          .where({
            shop_id: domainEvent.shop_id,
            platform: 'shopify',
            external_variant_id: variantId,
          })
          .first();

        if (!variantIdentity) continue;

        const variantRow = await trx('variants')
          .where({
            lasyncro_variant_id: variantIdentity.lasyncro_variant_id,
          })
          .first();

        if (!variantRow) continue;

        const quantity = li.quantity ?? 0;

        const unitPrice =
          li.originalUnitPriceSet?.shopMoney?.amount != null
            ? Number(li.originalUnitPriceSet.shopMoney.amount)
            : li.price != null
              ? Number(li.price)
              : 0;

        await trx('order_line_items')
          .insert({
            lasyncro_line_item_id: crypto
              .createHash('sha1')
              .update(
                `${ORDER_UUID_NAMESPACE}:${domainEvent.shop_id}:shopify:${externalOrderId}:line:${li.id}`
              )
              .digest('hex')
              .slice(0, 32)
              .replace(
                /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
                '$1-$2-$3-$4-$5'
              ),
            lasyncro_order_id: lasyncroOrderId,
            lasyncro_product_id: variantRow.lasyncro_product_id,
            lasyncro_variant_id: variantIdentity.lasyncro_variant_id,
            title: li.title ?? '',
            sku: li.sku ?? null,
            quantity,
            unit_price: unitPrice,
            line_total: unitPrice * quantity,
            platform: 'shopify',
            external_line_item_id: li.id,
            created_at: canonicalEventTime,
            updated_at: canonicalEventTime,
          })
          .onConflict(['platform', 'external_line_item_id'])
          .ignore();
      }
    }

    const orderRow = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('aggregate_version')
      .first();

    if (!orderRow) {
      throw new Error('[ORDER_VERSION_MISSING_AFTER_CREATE]');
    }

    const countRow = await trx('orders')
      .where({ shop_id: domainEvent.shop_id })
      .count<{ count: string }>('* as count')
      .first();

    const currentCount = Number(countRow?.count ?? 0);

    if (currentCount >= 1) {
      await FirstInsightService.computeAndPersist(domainEvent.shop_id);
    }

    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    await advanceCursor(trx, ORDERS_PROJECTION, domain_event_id, eventRow.event_time);
  });
}