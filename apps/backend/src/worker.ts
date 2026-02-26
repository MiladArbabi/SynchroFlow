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
    const { staged_event_id } = JSON.parse(content);

    if (!staged_event_id) {
      getEventChannel().ack(msg as any);
      return;
    }

    /**
     * REPLAY SAFETY GUARD
     * -------------------
     * If processed_at is already set,
     * this event has already been executed.
     * Never allow double execution.
     */
    const stagedEvent = await db('staged_events')
      .where({ id: staged_event_id })
      .whereNull('processed_at')
      .first<{
        id: number;
        shop_id: number;
        event_type: string;
        raw_payload: Record<string, any>;
      }>();

    /**
     * STAGED EVENT TIME ANCHOR
     * -------------------------
     * Used for deterministic processed_at marking.
     * Never use wall-clock.
     */
    const raw = stagedEvent.raw_payload as any;

    const stagedEventTime =
      raw?.updated_at ??
      raw?.created_at ??
      null;

    if (!stagedEventTime) {
      throw new Error(
        '[EVENT_TIME_VIOLATION] Staged event missing event-time'
      );
    }

    const stagedEventTimestamp = new Date(stagedEventTime);

    if (!stagedEvent) {
      /**
       * Either:
       * - staged event does not exist
       * - OR already processed (replay guard)
       *
       * In both cases: ACK safely.
       */
      getEventChannel().ack(msg as any);
      return;
    }

    /**
     * CANONICAL EVENT DISPATCHER
     * ---------------------------
     * All external signals must be materialized
     * exclusively through this boundary.
     */
    switch (stagedEvent.event_type) {

      /**
       * ---------------------------------------------------------
       * ORDER CREATION (Webhook + Sync Unified)
       * ---------------------------------------------------------
       */
      case 'orders/create':
      case 'orders/sync': {

        const payload = stagedEvent.raw_payload as any;
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

          const existingIdentity = await trx('external_order_identity_map')
            .where({
              shop_id: stagedEvent.shop_id,
              platform: 'shopify',
              external_order_id: externalOrderId,
            })
            .first();

          if (existingIdentity) return;

          const lasyncroOrderId = crypto.randomUUID();
          newlyCreatedOrderId = lasyncroOrderId;

          await trx('orders').insert({
            lasyncro_order_id: lasyncroOrderId,
            shop_id: stagedEvent.shop_id,

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

            order_created_at: payload.createdAt ?? payload.created_at ?? null,
            order_updated_at: payload.updatedAt ?? payload.updated_at ?? null,

            payment_state: 'unpaid',

            /**
             * AGGREGATE VERSION INITIALIZATION
             * ---------------------------------
             * Creation = first domain mutation.
             */
            aggregate_version: 1,
          });

          await trx('external_order_identity_map').insert({
            lasyncro_order_id: lasyncroOrderId,
            shop_id: stagedEvent.shop_id,
            platform: 'shopify',
            external_order_id: externalOrderId,
          });

          /**
           * BASELINE FULFILLMENT HYDRATION (SYNC ONLY)
           * Transaction-bound to avoid pool exhaustion.
           */
          if (stagedEvent.event_type === 'orders/sync') {

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
                shop_id: stagedEvent.shop_id,
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
                lasyncro_line_item_id: crypto.randomUUID(),
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
            await OutboxService.enqueue(
              {
                aggregateType: 'order',
                aggregateId: newlyCreatedOrderId!,
                eventType: 'reconciliation.requested',
                payload: { lasyncroOrderId: newlyCreatedOrderId },
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
          const insight = await FirstInsightService.computeAndPersist(stagedEvent.shop_id);

          if (insight.delivered && !insight.alreadyDelivered) {
            const shopId = stagedEvent.shop_id;

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

        const payload = stagedEvent.raw_payload as any;
        const externalOrderId = String(payload.id);

        const lasyncroOrderId = await resolveExternalOrderId(
          stagedEvent.shop_id,
          'shopify',
          externalOrderId
        );

        if (!lasyncroOrderId) break;

        await db.transaction(async (trx) => {

          /**
           * PAYMENT EVENT TIME (Event-Time Required)
           * -----------------------------------------
           * Payment webhook must provide event-time.
           * Wall-clock fallback forbidden.
           */
          const paymentEventTime =
            payload.updated_at ??
            payload.processed_at ??
            null;

          if (!paymentEventTime) {
            throw new Error(
              '[EVENT_TIME_VIOLATION] Payment missing event-time'
            );
          }

          const paymentTimestamp = new Date(paymentEventTime);

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

        const payload = stagedEvent.raw_payload as any;
        const externalOrderId = String(payload.order_id);

        const lasyncroOrderId = await resolveExternalOrderId(
          stagedEvent.shop_id,
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
         * FULFILLMENT EVENT TIME (Event-Time Required)
         * ---------------------------------------------
         */
        const fulfillmentEventTime =
          payload.updated_at ??
          payload.created_at ??
          null;

        if (!fulfillmentEventTime) {
          throw new Error(
            '[EVENT_TIME_VIOLATION] Fulfillment missing event-time'
          );
        }

        const fulfillmentTimestamp = new Date(fulfillmentEventTime);

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

      const payload = stagedEvent.raw_payload as any;

      let lasyncroOrderId: string | null = null;

      await db.transaction(async (trx) => {

        lasyncroOrderId = await resolveExternalOrderId(
          stagedEvent.shop_id,
          'shopify',
          String(payload.order_id),
          trx
        );

        if (!lasyncroOrderId) return;

        /**
         * REFUND EVENT TIME (Event-Time Required)
         * ----------------------------------------
         * Refund webhook must provide canonical event-time.
         * Wall-clock fallback forbidden.
         */
        const refundEventTime =
          payload.created_at ??
          payload.processed_at ??
          null;

        if (!refundEventTime) {
          throw new Error(
            '[EVENT_TIME_VIOLATION] Refund missing event-time'
          );
        }

        const refundExecutedAt = new Date(refundEventTime);

        const externalRefundId = String(payload.id);

        let execution = await trx('refund_executions')
          .where({
            platform: 'shopify',
            external_refund_id: externalRefundId,
          })
          .first();

        if (!execution) {

          const refundExecutionId = crypto.randomUUID();

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
              lasyncro_refund_line_item_id: crypto.randomUUID(),
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
     * INGESTION SUCCESS COMMIT (ATOMIC)
     * ----------------------------------
     * Clears failure markers and finalizes deterministic ingestion.
     */
    await db('staged_events')
      .where({ id: staged_event_id })
      .update({
        processed_at: stagedEventTimestamp,
        failed_at: null,
        retry_count: 0,
        error_message: null,
      });

    getEventChannel().ack(msg as any);

  } catch (error) {
    console.error('[worker] Error processing staged event:', error);

    /**
     * INGESTION FAILURE TRACKING
     * ---------------------------
     * Persist failure state before nack.
     * Guarantees:
     * - retry visibility
     * - deterministic replay observability
     * - root cause traceability
     */
    try {
      const parsed = JSON.parse(content) as { staged_event_id?: number };

      let processingSucceeded = false;

      if (parsed?.staged_event_id) {
        await db('staged_events')
          .where({ id: parsed.staged_event_id })
          .update({
            failed_at: db.fn.now(),
            retry_count: db.raw('retry_count + 1'),
            error_message:
              error instanceof Error
                ? error.message
                : JSON.stringify(error),
          });
          } else {
            console.error('[INGESTION_FAILURE_NO_STAGED_ID]', { rawMessage: content });
          }
        } catch (parseError) {
          console.error('[INGESTION_FAILURE_PARSE_ERROR]', {
            originalMessage: content,
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          });
        }

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

  console.log('[worker] Worker ready. Awaiting staged events...');
}