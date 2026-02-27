// apps/backend/src/worker.ts

import { getQueueChannel } from './queue.js';
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { resolveExternalOrderId } from './services/identity/resolveExternalOrder.service.js';
import OrderFulfillmentIngestionService from './services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';

import { FirstInsightService } from './services/first-insight.service.js';
import { FT0CompletionService } from './services/ft0-completion.service.js';

import OutboxService from './services/outbox/outbox.service.js';

/**
 * FT0 EXECUTION LATCH (PROCESS-SCOPED)
 * -------------------------------------
 * Prevents concurrent FT0 executions for the same shop
 * within this worker process.
 *
 * This does NOT replace DB idempotency.
 * It only suppresses redundant concurrent triggers.
 */
const ft0InFlight = new Set<number>();

/**
 * DETERMINISTIC ORDER ID NAMESPACE
 * --------------------------------
 * Stable namespace required for uuidv5.
 * Must never change once deployed.
 */
const ORDER_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // fixed RFC namespace

/**
 * PROJECTION IDENTITY
 * -------------------
 * This worker projects domain_events into operational tables.
 */
const PROJECTION_NAME = 'orders_projection';

// Lazily obtain the specific channel for 'events'
let eventChannel: ReturnType<typeof getQueueChannel> | null = null;
function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

export async function processMessage(msg: { content: Buffer } | null) {
  if (msg === null) return;

  const content = msg.content.toString();

  try {
    const { domain_event_id } = JSON.parse(content);

    if (!domain_event_id) {
      getEventChannel().ack(msg as any);
      return;
    }

    /**
     * DOMAIN EVENT FETCH
     * ------------------
     * domain_events are immutable.
     * Replay safety must be enforced via projection cursors.
     */
    const domainEvent = await db('domain_events')
    .where({ id: domain_event_id })
    .first<{
      id: number;
      shop_id: number;
      event_type: string;
      event_payload: Record<string, any>;
      event_time: Date;
    }>();

    if (!domainEvent) {
      throw new Error(
        `[DOMAIN_EVENT_NOT_FOUND] id=${domain_event_id}`
      );
    }

    /**
     * CANONICAL EVENT-TIME ANCHOR
     * ---------------------------
     * Worker must rely on domain_events.event_time.
     * Raw payload timestamps are forbidden beyond ingestion.
     */
    if (!domainEvent.event_time) {
      throw new Error(
        '[EVENT_TIME_VIOLATION] domain_event missing canonical event_time'
      );
    }

    const canonicalEventTime = new Date(domainEvent.event_time);

    /**
     * PROJECTION CURSOR ENFORCEMENT
     * -----------------------------
     * Enforces strict monotonic processing.
     */
    const cursor = await db('projection_cursors')
      .where({ projection_name: PROJECTION_NAME })
      .first<{ last_processed_event_id: number }>();

    const expectedNextId =
      cursor?.last_processed_event_id != null
        ? cursor.last_processed_event_id + 1
        : domain_event_id;

    if (domain_event_id !== expectedNextId) {
      throw new Error(
        `[PROJECTION_ORDER_VIOLATION] expected=${expectedNextId} got=${domain_event_id}`
      );
    }

    /**
     * CANONICAL EVENT DISPATCHER
     * ---------------------------
     * All external signals must be materialized
     * exclusively through this boundary.
     */
    switch (domainEvent.event_type) {

      /**
       * ---------------------------------------------------------
       * ORDER CREATION (Webhook + Sync Unified)
       * ---------------------------------------------------------
       */
      case 'orders/create':
      case 'orders/sync': {

        const payload = domainEvent.event_payload as any;
        /**
         * Shopify Order ID Canonicalization
         * ----------------------------------
         * Accepts:
         * - numeric (webhooks)
         * - gid://shopify/Order/<id> (GraphQL)
         */
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

        let newlyCreatedOrderId: string | null = null;

        await db.transaction(async (trx) => {

          /**
           * DETERMINISTIC ORDER ID
           * ----------------------
           * Derived from (shop_id + platform + external_order_id).
           * Enables full rebuild without identity map dependency.
           */
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
          
          newlyCreatedOrderId = lasyncroOrderId;

          /**
           * EXISTENCE CHECK (DETERMINISTIC)
           * --------------------------------
           * Order ID is deterministic.
           * If order already exists, skip creation.
           */
          const existingOrder = await trx('orders')
            .where({ lasyncro_order_id: lasyncroOrderId })
            .first();

          if (existingOrder) return;

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

            /**
             * ORDER CREATION EVENT-TIME (Canonical)
             * --------------------------------------
             * Must rely exclusively on domain_events.event_time.
             */
            order_created_at: canonicalEventTime,

            /**
             * Initial update anchor equals canonical creation time.
             * Future mutations will advance this deterministically.
             */
            order_updated_at: canonicalEventTime,

            payment_state: 'unpaid',

            /**
             * AGGREGATE VERSION INITIALIZATION
             * ---------------------------------
             * Creation = first domain mutation.
             */
            aggregate_version: 1,
          });

          /**
           * Identity map retained only for legacy compatibility.
           * Deterministic ID removes replay dependency.
           */
          await trx('external_order_identity_map')
            .insert({
              lasyncro_order_id: lasyncroOrderId,
              shop_id: domainEvent.shop_id,
              platform: 'shopify',
              external_order_id: externalOrderId,
            })
            .onConflict(['platform', 'external_order_id'])
            .ignore();

          /**
           * BASELINE FULFILLMENT HYDRATION (SYNC ONLY)
           * Transaction-bound to avoid pool exhaustion.
           */
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
                lasyncroOrderId: lasyncroOrderId,
                status: baselineStatus,
              },
              trx   // CRITICAL: reuse transaction
            );
          }

          /**
           * Line Item Materialization
           * -------------------------
           * Required for OAuth sync path.
           */
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
                /**
                 * DETERMINISTIC LINE ITEM ID
                 * --------------------------
                 * Derived from (shop_id + external_order_id + external_line_item_id).
                 */
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
              })
              .onConflict(['platform', 'external_line_item_id'])
              .ignore();
          }

          /**
           * ❗ CRITICAL EXECUTION BOUNDARY
           * --------------------------------
           * order_fulfillment_status MUST NOT be initialized here.
           *
           * Reason:
           * - Initial sync snapshot hydrator already establishes baseline execution truth.
           * - Webhook ingestion updates execution deltas.
           * - Writing default "pending" here corrupts canonical state.
           *
           * This worker is NOT an execution authority.
           */
        });

        if (newlyCreatedOrderId) {
          await db.transaction(async (trx) => {

            const orderRow = await trx('orders')
              .where({ lasyncro_order_id: newlyCreatedOrderId })
              .select('aggregate_version')
              .first();

            if (!orderRow) {
              throw new Error('[ORDER_VERSION_MISSING_AFTER_CREATE]');
            }

            await OutboxService.enqueue(
              {
                aggregateType: 'order',
                aggregateId: newlyCreatedOrderId!,
                eventType: 'reconciliation.requested',
                payload: {
                  lasyncroOrderId: newlyCreatedOrderId,
                  aggregateVersion: orderRow.aggregate_version,
                },
              },
              trx
            );
          });

          /**
           * FIRST INSIGHT + FT0 TRIGGER
           * --------------------------------
           * FT0 must only execute when first insight transitions
           * from NOT_DELIVERED → DELIVERED.
           *
           * This guarantees:
           * - Orders exist
           * - Insight persisted
           * - Canonical ingestion completed
           * - Single execution
           */
          const insight = await FirstInsightService.computeAndPersist(domainEvent.shop_id);

          if (insight.delivered && !insight.alreadyDelivered) {
            const shopId = domainEvent.shop_id;

            // Prevent concurrent FT0 execution in this process
            if (!ft0InFlight.has(shopId)) {                                                               
               
              ft0InFlight.add(shopId);
              try {
                await FT0CompletionService.evaluateAndComplete(shopId);
              } finally {
                ft0InFlight.delete(shopId);
              }
            }
          }
        }

        break;
      }

      /**
       * ---------------------------------------------------------
       * PAYMENT EVENT
       * ---------------------------------------------------------
       */
      case 'orders/paid': {

        const payload = domainEvent.event_payload as any;
        const externalOrderId = String(payload.id);

        const lasyncroOrderId = await resolveExternalOrderId(
          domainEvent.shop_id,
          'shopify',
          externalOrderId
        );

        if (!lasyncroOrderId) break;

        await db.transaction(async (trx) => {
        
        /**
         * PAYMENT EVENT TIME (Canonical)
         * --------------------------------
         * Must rely exclusively on domain_events.event_time.
         * Raw payload timestamps are forbidden beyond ingestion.
         */
        const paymentTimestamp = canonicalEventTime;

          /**
           * CASH REALIZATION COMMIT
           * -----------------------
           * Payment webhook is authoritative signal of payment confirmation.
           * Sets paid_at if not already set (idempotent).
           */
          await trx('orders')
            .where({ lasyncro_order_id: lasyncroOrderId })
            .update({
              payment_state: 'paid',

              // Preserve first payment timestamp only (idempotent)
              paid_at: trx.raw(
                'COALESCE(paid_at, ?)',
                [paymentTimestamp]
              ),

              // Event-time anchored mutation
              order_updated_at: paymentTimestamp,
            });

          /**
           * FETCH CURRENT AGGREGATE VERSION
           * --------------------------------
           * Must reflect post-mutation version.
           */
          const { aggregate_version } = await trx('orders')
            .where({ lasyncro_order_id: lasyncroOrderId })
            .select('aggregate_version')
            .first();

          await OutboxService.enqueue(
            {
              aggregateType: 'order',
              aggregateId: lasyncroOrderId,
              eventType: 'reconciliation.requested',
              payload: { 
                lasyncroOrderId,
                aggregateVersion: aggregate_version,
               },
            },
            trx
          );

        });

        break;
      }

      /**
       * ---------------------------------------------------------
       * FULFILLMENT EVENT
       * ---------------------------------------------------------
       */
      case 'orders/fulfilled': {

        const payload = domainEvent.event_payload as any;
        const externalOrderId = String(payload.order_id);

        const lasyncroOrderId = await resolveExternalOrderId(
          domainEvent.shop_id,
          'shopify',
          externalOrderId
        );

        if (!lasyncroOrderId) break;

        /**
         * FULFILLMENT EXECUTION TRUTH
         * ----------------------------
         * Shopify `fulfillments/create` and `fulfillments/update`
         * represent authoritative execution signals.
         *
         * Observed payload structure:
         * - No top-level `fulfillment_status`
         * - Top-level `status` may be "success"
         *
         * Therefore:
         * - Event type itself implies fulfillment
         * - Only explicit cancellation overrides
         */
        const status =
          payload.status === 'cancelled'
            ? 'cancelled'
            : 'fulfilled';
        
        /**
         * FULFILLMENT EVENT TIME (Canonical)
         * -----------------------------------
         * Must rely exclusively on domain_events.event_time.
         * Raw payload timestamps are forbidden beyond ingestion.
         */
        const fulfillmentTimestamp = canonicalEventTime;

        await db.transaction(async (trx) => {

        await OrderFulfillmentIngestionService.ingestStatus(
          {
            lasyncroOrderId,
            status,
          },
          trx
        );

        /**
         * AGGREGATE MUTATION — FULFILLMENT
         */
        await trx('orders')
          .where({ lasyncro_order_id: lasyncroOrderId })
          .update({
            order_updated_at: fulfillmentTimestamp,
            aggregate_version: trx.raw('aggregate_version + 1'),
          });

        /**
         * FETCH CURRENT AGGREGATE VERSION
         * --------------------------------
         * Must reflect post-mutation version.
         */
        const { aggregate_version } = await trx('orders')
          .where({ lasyncro_order_id: lasyncroOrderId })
          .select('aggregate_version')
          .first();

        await OutboxService.enqueue(
          {
            aggregateType: 'order',
            aggregateId: lasyncroOrderId,
            eventType: 'reconciliation.requested',
            payload: {
              lasyncroOrderId,
              aggregateVersion: aggregate_version,
            },
          },
          trx
        );

      });

        break;
    }

    case 'refunds/create': {

      const payload = domainEvent.event_payload as any;

      let lasyncroOrderId: string | null = null;

      await db.transaction(async (trx) => {

        lasyncroOrderId = await resolveExternalOrderId(
          domainEvent.shop_id,
          'shopify',
          String(payload.order_id),
          trx
        );

        if (!lasyncroOrderId) return;

        /**
         * REFUND EVENT TIME (Canonical)
         * ------------------------------
         * Must rely exclusively on domain_events.event_time.
         * Raw payload timestamps are forbidden beyond ingestion.
         */
        const refundExecutedAt = canonicalEventTime;

        const externalRefundId = String(payload.id);

        let execution = await trx('refund_executions')
          .where({
            platform: 'shopify',
            external_refund_id: externalRefundId,
          })
          .first();

        if (!execution) {

          /**
           * DETERMINISTIC REFUND EXECUTION ID
           * ----------------------------------
           * Derived from (shop_id + external_order_id + external_refund_id).
           */
          const refundExecutionId = crypto
            .createHash('sha1')
            .update(
              `${ORDER_UUID_NAMESPACE}:${domainEvent.shop_id}:shopify:${payload.order_id}:refund:${externalRefundId}`
            )
            .digest('hex')
            .slice(0, 32)
            .replace(
              /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
              '$1-$2-$3-$4-$5'
            );

          await trx('refund_executions').insert({
            lasyncro_refund_execution_id: refundExecutionId,
            lasyncro_order_id: lasyncroOrderId,
            platform: 'shopify',
            external_refund_id: externalRefundId,
            total_refund_amount: 0,
            executed_at: refundExecutedAt,
          });

          execution = {
            lasyncro_refund_execution_id: refundExecutionId,
          };
        }

        /**
         * REFUND LINE ITEM INGESTION
         * ---------------------------
         * Economic mutation is deferred to reconciliation.
         * This layer is persistence-only.
         */

        const refundLineItems = Array.isArray(payload.refund_line_items)
          ? payload.refund_line_items
          : [];

        for (const item of refundLineItems) {

          const externalLineItemId = String(
            item?.line_item?.id ?? item?.line_item_id ?? ''
          );

          if (!externalLineItemId) continue;

          const revenueUnit = await trx('order_line_items')
            .select('lasyncro_variant_id', 'lasyncro_product_id')
            .where({
              lasyncro_order_id: lasyncroOrderId,
              platform: 'shopify',
              external_line_item_id: externalLineItemId,
            })
            .first();

          if (!revenueUnit) continue;

          const ru = await trx('order_revenue_units')
            .select('lasyncro_revenue_unit_id')
            .where({
              lasyncro_order_id: lasyncroOrderId,
              lasyncro_variant_id: revenueUnit.lasyncro_variant_id,
            })
            .first();

          if (!ru) continue;

          await trx('refund_execution_line_items')
            .insert({
              /**
               * DETERMINISTIC REFUND LINE ITEM ID
               * ----------------------------------
               * Derived from (refund_execution_id + revenue_unit_id).
               */
              lasyncro_refund_line_item_id: crypto
                .createHash('sha1')
                .update(
                  `${ORDER_UUID_NAMESPACE}:${execution.lasyncro_refund_execution_id}:${ru.lasyncro_revenue_unit_id}`
                )
                .digest('hex')
                .slice(0, 32)
                .replace(
                  /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
                  '$1-$2-$3-$4-$5'
                ),
              lasyncro_refund_execution_id:
                execution.lasyncro_refund_execution_id,
              lasyncro_revenue_unit_id: ru.lasyncro_revenue_unit_id,
              refunded_quantity: Number(item.quantity ?? 0),
              refunded_amount: Number(item.subtotal ?? 0),
            })
            .onConflict([
              'lasyncro_refund_execution_id',
              'lasyncro_revenue_unit_id',
            ])
            .ignore();
        }

        /**
         * AGGREGATE MUTATION — REFUND
         * -----------------------------
         * - Event-time anchored
         * - Version incremented atomically
         */
        await trx('orders')
          .where({ lasyncro_order_id: lasyncroOrderId })
          .update({
            order_updated_at: refundExecutedAt,
            aggregate_version: trx.raw('aggregate_version + 1'),
          });

        /**
         * FETCH CURRENT AGGREGATE VERSION
         * --------------------------------
         * Must reflect post-mutation version.
         */
        const { aggregate_version } = await trx('orders')
          .where({ lasyncro_order_id: lasyncroOrderId })
          .select('aggregate_version')
          .first();

        /**
         * VERSION-COUPLED OUTBOX EVENT
         * ------------------------------
         * Enables strict per-aggregate ordering.
         */
        await OutboxService.enqueue(
          {
            aggregateType: 'order',
            aggregateId: lasyncroOrderId,
            eventType: 'reconciliation.requested',
            payload: {
              lasyncroOrderId,
              aggregateVersion: aggregate_version,
            },
          },
          trx
        );
      });

      break;
    }
  

      default:
        break;
    }

    /**
     * CURSOR ADVANCE (ATOMIC)
     * -----------------------
     */
    await db.transaction(async (trx) => {
      const existing = await trx('projection_cursors')
        .where({ projection_name: PROJECTION_NAME })
        .first();

      if (!existing) {
        await trx('projection_cursors').insert({
          projection_name: PROJECTION_NAME,
          last_processed_event_id: domain_event_id,
        });
      } else {
        await trx('projection_cursors')
          .where({ projection_name: PROJECTION_NAME })
          .update({
            last_processed_event_id: domain_event_id,
            updated_at: trx.fn.now(),
          });
      }
    });

    /**
     * SUCCESS:
     * domain_events are immutable.
     * Projection progress must be tracked via projection_cursors.
     */

    getEventChannel().ack(msg as any);

  } catch (error) {
    console.error('[worker] Error processing domain event:', error);

    /**
     * FAILURE:
     * domain_events are immutable.
     * Projection retry orchestration must be externalized.
     * No event log mutation allowed.
     */

    try {
      getEventChannel().nack(msg as any, false, false);

    } catch (nackError) {
      console.error(
        '[worker] Failed to nack message after processing error:',
        nackError
      );
    }
  }
}

export function startWorker() {
  console.log('[worker] Starting unified canonical worker...');

  const channel = getEventChannel();

  /**
   * HARD CONCURRENCY CAP
   * --------------------
   * Must remain <= DB pool max.
   * Current DB pool max = 20
   *
   * We cap at 5 for safety.
   */
  channel.addSetup(async (ch: any) => {
    await ch.prefetch(5);
  });

  channel.consume('events', processMessage, { noAck: false });

  console.log('[worker] Worker ready. Awaiting domain events...');
}