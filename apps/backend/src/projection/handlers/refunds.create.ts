// apps/backend/src/projection/handlers/refunds.create.ts

/**
 * REFUNDS — CREATE PROJECTION HANDLER
 * ------------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * No behavior changes.
 * No cleanup.
 * Determinism issues intentionally preserved.
 */
import crypto from 'crypto';
import { Knex } from 'knex';

import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';

const ORDER_UUID_NAMESPACE =
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleRefundsCreate({
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

  const payload = domainEvent.event_payload as any;

  let lasyncroOrderId: string | null = null;

  /**
   * TRANSACTION CONTRACT
   * Projection engine owns the transaction boundary.
   * Handlers must reuse provided trx.
   */

    /**
     * CURSOR ENFORCEMENT MOVED
     * ------------------------
     * Projection ordering is now enforced centrally
     * in projection.engine.ts.
     *
     * Handlers must remain pure projection logic
     * without queue or cursor coordination.
     */

    lasyncroOrderId = await resolveExternalOrderId(
      domainEvent.shop_id,
      'shopify',
      String(payload.order_id),
      trx
    );

    if (!lasyncroOrderId) {
      /**
       * CRITICAL DATA LOSS GUARD
       * ------------------------
       * Refund event without order reference.
       * Silent drop would permanently lose financial event.
       */
      console.error('[PROJECTION_REFUND_MISSING_ORDER_ID]', {
        reason: 'Missing lasyncroOrderId in refund event payload'
      });

      return;
    }

    const refundExecutedAt = canonicalEventTime;
    const externalRefundId = String(payload.id);

    let execution = await trx('refund_executions')
      .where({
        platform: 'shopify',
        external_refund_id: externalRefundId,
      })
      .first();

    if (!execution) {

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
        /**
         * executed_at is derived from domain event time.
         * The NOT NULL constraint requires it at insert time.
         * Event time is the authoritative execution timestamp
         * for refunds received via webhook.
         */
        executed_at: canonicalEventTime,
      });

      execution = {
        lasyncro_refund_execution_id: refundExecutionId,
      };
    }

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

    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        order_updated_at: refundExecutedAt,
        aggregate_version: trx.raw('aggregate_version + 1'),
      });

    /**
     * CURSOR ADVANCEMENT REMOVED
     * --------------------------
     * Projection engine centrally manages replay progress.
     * Handlers must remain pure projection logic.
     */
  };