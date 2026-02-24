// apps/backend/src/worker.ts

import { getQueueChannel } from './queue.js';
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import { resolveExternalOrderId } from './services/identity/resolveExternalOrder.service.js';
import OrderFulfillmentIngestionService from './services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';
import { resolveRefundExecution } from './workers/refundResolution.worker.js';

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

    const stagedEvent = await db('staged_events')
      .where({ id: staged_event_id })
      .first<{
        id: number;
        shop_id: number;
        event_type: string;
        raw_payload: Record<string, any>;
      }>();

    if (!stagedEvent) {
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

          await trx('orders')
            .where({ lasyncro_order_id: lasyncroOrderId })
            .update({
              payment_state: 'paid',
              order_updated_at: trx.fn.now(),
            });

          await OutboxService.enqueue(
            {
              aggregateType: 'order',
              aggregateId: lasyncroOrderId,
              eventType: 'reconciliation.requested',
              payload: { lasyncroOrderId },
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

        await db.transaction(async (trx) => {

        await OrderFulfillmentIngestionService.ingestStatus(
          {
            lasyncroOrderId,
            status,
          },
          trx
        );

        await OutboxService.enqueue(
          {
            aggregateType: 'order',
            aggregateId: lasyncroOrderId,
            eventType: 'reconciliation.requested',
            payload: {
              lasyncroOrderId,
            },
          },
          trx
        );

      });

        break;
      }

      /**
       * ---------------------------------------------------------
       * REFUND EVENT
       * ---------------------------------------------------------
       */
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
            executed_at: payload.created_at
              ? new Date(payload.created_at)
              : new Date(),
          });

          execution = {
            lasyncro_refund_execution_id: refundExecutionId,
          };
        }

        await resolveRefundExecution(
          execution.lasyncro_refund_execution_id
        );
      });

      if (lasyncroOrderId) {
        await db.transaction(async (trx) => {
          await OutboxService.enqueue(
            {
              aggregateType: 'order',
              aggregateId: lasyncroOrderId!,
              eventType: 'reconciliation.requested',
              payload: { lasyncroOrderId },
            },
            trx
          );
        });
      }

      break;
    }

      default:
        break;
    }

    getEventChannel().ack(msg as any);

  } catch (error) {
    console.error('[worker] Error processing staged event:', error);

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