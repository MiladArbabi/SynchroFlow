// apps/backend/src/projection/handlers/refunds.create.ts

/**
 * REFUNDS — CREATE PROJECTION HANDLER
 * ------------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * REORDERED 2026-07-07 (WEB-RETURN-02 fix): reconciliation guard now
 * runs BEFORE the line-item loop, not after. Previously the line-item
 * loop always did a blind INSERT ... ON CONFLICT(refund_execution_id,
 * revenue_unit_id) IGNORE — which meant a revenue unit already covered
 * by a scan-intake manual line (lasyncro_refund_execution_id: null,
 * real operator-entered item_condition/quantity_received) would get a
 * SECOND, separate row inserted once the refund arrived, rather than
 * the manual line being reconciled/linked. Reordering lets the loop
 * check for and update an existing manual line first.
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

  lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    String(payload.order_id),
    trx
  );

  if (!lasyncroOrderId) {
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
      executed_at: canonicalEventTime,
    });

    execution = {
      lasyncro_refund_execution_id: refundExecutionId,
    };
  }

  /**
   * RECONCILIATION GUARD (scan-intake linking) — moved before the
   * line-item loop, see file header.
   * ------------------------------------------------------------
   * A return_job may already exist for this order with no refund
   * linked yet (created via scan intake, resolveOrCreateReturnJobForScan)
   * — the physical parcel arrived before this webhook did. Link the
   * refund to that job instead of creating a duplicate.
   *
   * No status filter (removed whereNotIn(['complete'])) — WEB-RETURN-02
   * fix: a scan-intake job commonly completes before its refund webhook
   * arrives. Excluding complete jobs meant this handler silently created
   * a SECOND return_jobs row (source: 'system_auto', zero lines) instead
   * of linking the real, already-worked job.
   */
  const scanCreatedJob = await trx('return_jobs')
    .where({
      shop_id: domainEvent.shop_id,
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_refund_execution_id: null,
    })
    .orderBy('created_at', 'desc')
    .first();

  if (scanCreatedJob) {
    await trx('return_jobs')
      .where({ return_job_id: scanCreatedJob.return_job_id })
      .update({
        lasyncro_refund_execution_id: execution.lasyncro_refund_execution_id,
        updated_at: canonicalEventTime,
      });

    // Backfill the reason captured at job completion onto the now-linked
    // refund_executions row.
    if (scanCreatedJob.return_reason) {
      await trx('refund_executions')
        .where('lasyncro_refund_execution_id', execution.lasyncro_refund_execution_id)
        .update({
          return_reason: scanCreatedJob.return_reason,
          return_notes: scanCreatedJob.return_notes,
        });
    }
  } else {
    const returnJobId = crypto
      .createHash('sha1')
      .update(
        `${ORDER_UUID_NAMESPACE}:return_job:${execution.lasyncro_refund_execution_id}`
      )
      .digest('hex')
      .slice(0, 32)
      .replace(
        /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
        '$1-$2-$3-$4-$5'
      );

    await trx('return_jobs')
      .insert({
        return_job_id: returnJobId,
        shop_id: domainEvent.shop_id,
        origin: 'customer_return',
        lasyncro_refund_execution_id: execution.lasyncro_refund_execution_id,
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending',
        claimed_by: null,
        source: 'system_auto',
      })
      .onConflict('lasyncro_refund_execution_id')
      .ignore();
  }

  /**
   * LINE ITEMS — now runs after reconciliation, so it can check for and
   * reconcile into an existing scan-intake manual line rather than
   * blindly inserting a duplicate row for the same revenue unit.
   */
  const refundLineItems = Array.isArray(payload.refund_line_items)
    ? payload.refund_line_items
    : [];

  for (const item of refundLineItems) {
    const rawLineItemId = String(item?.line_item?.id ?? item?.line_item_id ?? '');
    const externalLineItemId = rawLineItemId.startsWith('gid://')
      ? rawLineItemId
      : rawLineItemId
        ? `gid://shopify/LineItem/${rawLineItemId}`
        : '';

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

    // Check for an existing scan-intake manual line on this revenue unit
    // for the job we just linked (or found) above — if the operator
    // already physically processed this exact unit before the refund
    // arrived, reconcile into that row instead of inserting a duplicate.
    const existingManualLine = scanCreatedJob
      ? await trx('refund_execution_line_items')
          .where({
            return_job_id: scanCreatedJob.return_job_id,
            lasyncro_revenue_unit_id: ru.lasyncro_revenue_unit_id,
            source: 'scan_intake_manual',
          })
          .first()
      : null;

    if (existingManualLine) {
      await trx('refund_execution_line_items')
        .where({ lasyncro_refund_line_item_id: existingManualLine.lasyncro_refund_line_item_id })
        .update({
          lasyncro_refund_execution_id: execution.lasyncro_refund_execution_id,
          refunded_amount: Number(item.subtotal ?? 0),
        });
      continue;
    }

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
        lasyncro_refund_execution_id: execution.lasyncro_refund_execution_id,
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
}