// apps/backend/src/services/wms/wmsAlerts.service.ts
import { Knex } from 'knex';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';

/**
 * WMS ALERT SERVICE (WM-21)
 * --------------------------
 * Proactive alert firing for WMS warehouse signals.
 *
 * Alert key format (KI-1 fix — colon-delimited, matches frontend routing):
 *   wms:exception:pick:{batchId}
 *   wms:exception:pack:{batchId}
 *   wms:stow:pending:{stowTaskId}
 *   wms:stow:exception:{stowTaskId}:{exceptionType}
 *   wms:batch:ready_to_pack:{batchId}
 *   wms:batch:ready_to_ship:{batchId}
 *   wms:batch:released:{batchId}
 *   wms:receive:arrived:{poId}
 *   wms:receive:exception:{jobId}:{variantId}
 *
 * Category mapping (blueprint §6):
 *   warehouse_floor  — pick/pack/stow/batch signals  (audience: operator)
 *   supplier_inbound — receive/PO signals             (audience: operator or owner)
 *
 * Rules:
 * - Upsert on (shop_id, alert_key) — idempotent
 * - Auto-resolve when underlying condition clears
 */

type AlertSeverity = 'critical' | 'warning' | 'info';
type AlertCategory = 'warehouse_floor' | 'supplier_inbound' | 'stock_reorder' | 'revenue_at_risk' | 'money_margin' | 'data_trust';
type AlertAudience = 'operator' | 'owner' | 'all';

async function upsertWmsAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    alertKey: string;
    alertType: string;
    severity: AlertSeverity;
    title: string;
    message: string;
    entityId?: string;
    entityType?: string;
    isActive: boolean;
    category: AlertCategory;
    audience: AlertAudience;
  }
): Promise<void> {
  const {
    shopId, alertKey, alertType, severity,
    title, message, entityId, entityType,
    isActive, category, audience,
  } = params;

  await trx.raw(`
    INSERT INTO alerts (
      shop_id, alert_key, source, alert_type, severity,
      title, message, entity_id, entity_type,
      revenue_impact, is_active, category, audience, dismissed_at
    ) VALUES (
      ?, ?, 'wms', ?, ?,
      ?, ?, ?, ?,
      NULL, ?, ?, ?, ?
    )
    ON CONFLICT (shop_id, alert_key) DO UPDATE SET
      is_active   = EXCLUDED.is_active,
      title       = EXCLUDED.title,
      message     = EXCLUDED.message,
      category    = EXCLUDED.category,
      audience    = EXCLUDED.audience,
      updated_at  = CURRENT_TIMESTAMP,
      dismissed_at = CASE
        WHEN EXCLUDED.is_active = false THEN CURRENT_TIMESTAMP
        ELSE alerts.dismissed_at
      END
  `, [
    shopId, alertKey, alertType, severity,
    title, message, entityId ?? null, entityType ?? null,
    isActive, category, audience, isActive ? null : new Date(),
  ]);
}

// ─────────────────────────────────────────
// Pick/Pack Exception Raised
// category: warehouse_floor | audience: operator (floor signal)
// ─────────────────────────────────────────

export async function firePickExceptionAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    batchId: string;
    stage: 'pick' | 'pack';
    exceptionType: string;
    variantTitle?: string;
  }
): Promise<void> {
  const { shopId, batchId, stage, exceptionType, variantTitle } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();
  const stageLabel = stage === 'pick' ? 'Pick' : 'Pack';
  const typeLabel  = exceptionType.replace(/_/g, ' ');

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:exception:${stage}:${batchId}`,
    alertType:  stage === 'pick' ? 'wms_pick_exception' : 'wms_pack_exception',
    severity:   'warning',
    title:      `${stageLabel} exception — ${typeLabel}`,
    message:    `${stageLabel} exception reported on batch ${batchShort}${variantTitle ? ` for ${variantTitle}` : ''}. Review in Problem Center.`,
    entityId:   batchId,
    entityType: 'pick_batch',
    isActive:   true,
    category:   'warehouse_floor',
    audience:   'operator',
  });

  dispatchNotification({
    shopId,
    payload: {
      title: `${stageLabel} exception reported`,
      body:  `Batch ${batchShort} — ${typeLabel}. Review in Problem Center.`,
      data:  { route: '/problem-center', batchId },
    },
    broadcastToRole: 'owner',
  }).catch((err) => console.error('[WMS_EXCEPTION_PUSH_FAILED]', err.message));

  console.info('[WMS_EXCEPTION_ALERT_FIRED]', { shopId, batchId, stage, exceptionType });
}

// ─────────────────────────────────────────
// Stow Task Created / Resolved
// category: warehouse_floor | audience: operator
// ─────────────────────────────────────────

export async function fireStowTaskAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    stowTaskId: string;
    isActive: boolean;
    trigger: string;
  }
): Promise<void> {
  const { shopId, stowTaskId, isActive, trigger } = params;
  const triggerLabel = trigger === 'order_cancelled_mid_pick'
    ? 'cancelled order mid-pick'
    : 'inbound stock received';

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:stow:pending:${stowTaskId}`,
    alertType:  'wms_stow_pending',
    severity:   'info',
    title:      isActive ? 'Stow task pending' : 'Stow task completed',
    message:    isActive
      ? `A stow task was created from ${triggerLabel}. Assign an operator to stow.`
      : 'Stow task completed successfully.',
    entityId:   stowTaskId,
    entityType: 'stow_task',
    isActive,
    category:   'warehouse_floor',
    audience:   'operator',
  });

  console.info('[WMS_STOW_ALERT_FIRED]', { shopId, stowTaskId, isActive });
}

// ─────────────────────────────────────────
// Stow Exception
// category: warehouse_floor | audience: owner (supervisor review needed)
// ─────────────────────────────────────────

export async function fireStowExceptionAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    stowTaskId: string;
    exceptionType: string;
    quantity: number;
  }
): Promise<void> {
  const { shopId, stowTaskId, exceptionType, quantity } = params;
  const typeLabel = exceptionType.replace(/_/g, ' ');

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:stow:exception:${stowTaskId}:${exceptionType}`,
    alertType:  'wms_stow_exception',
    severity:   'warning',
    title:      `Stow exception — ${typeLabel}`,
    message:    `${quantity} unit${quantity > 1 ? 's' : ''} reported as ${typeLabel} during stow. Item moved to problem bin.`,
    entityId:   stowTaskId,
    entityType: 'stow_task',
    isActive:   true,
    category:   'warehouse_floor',
    audience:   'owner',
  });

  console.info('[WMS_STOW_EXCEPTION_ALERT_FIRED]', { shopId, stowTaskId, exceptionType, quantity });
}

// ─────────────────────────────────────────
// Batch Ready to Pack
// category: warehouse_floor | audience: operator
// ─────────────────────────────────────────

export async function fireBatchReadyToPackAlert(
  trx: Knex | Knex.Transaction,
  params: { shopId: number; batchId: string; isActive: boolean }
): Promise<void> {
  const { shopId, batchId, isActive } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:batch:ready_to_pack:${batchId}`,
    alertType:  'wms_batch_ready_to_pack',
    severity:   'info',
    title:      'Batch ready to pack',
    message:    `Batch ${batchShort} pick is complete. A packer can now claim and start packing.`,
    entityId:   batchId,
    entityType: 'pick_batch',
    isActive,
    category:   'warehouse_floor',
    audience:   'operator',
  });

  if (isActive) {
    dispatchNotification({
      shopId,
      payload: {
        title: 'Batch ready to pack',
        body:  `Batch ${batchShort} pick complete. Claim it to start packing.`,
        data:  { route: '/wms', batchId },
      },
      broadcastToRole: 'operator',
    }).catch((err) => console.error('[WMS_READY_TO_PACK_PUSH_FAILED]', err.message));
  }

  console.info('[WMS_READY_TO_PACK_ALERT_FIRED]', { shopId, batchId, isActive });
}

// ─────────────────────────────────────────
// Batch Ready to Ship
// category: warehouse_floor | audience: operator
// ─────────────────────────────────────────

export async function fireBatchReadyToShipAlert(
  trx: Knex | Knex.Transaction,
  params: { shopId: number; batchId: string; isActive: boolean }
): Promise<void> {
  const { shopId, batchId, isActive } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:batch:ready_to_ship:${batchId}`,
    alertType:  'wms_batch_ready_to_ship',
    severity:   'info',
    title:      'Batch ready to ship',
    message:    `Batch ${batchShort} packing is complete. Orders are ready for ship confirmation.`,
    entityId:   batchId,
    entityType: 'pick_batch',
    isActive,
    category:   'warehouse_floor',
    audience:   'operator',
  });

  if (isActive) {
    dispatchNotification({
      shopId,
      payload: {
        title: 'Batch ready to ship',
        body:  `Batch ${batchShort} packing complete. Confirm shipment.`,
        data:  { route: '/wms', batchId },
      },
      broadcastToRole: 'owner',
    }).catch((err) => console.error('[WMS_READY_TO_SHIP_PUSH_FAILED]', err.message));
  }

  console.info('[WMS_READY_TO_SHIP_ALERT_FIRED]', { shopId, batchId, isActive });
}

// ─────────────────────────────────────────
// PO Shipped — Receive Session Needed (FEAT-004)
// category: supplier_inbound | audience: operator
// ─────────────────────────────────────────

export async function fireReceiveArrivedAlert(
  trx: Knex.Transaction,
  params: { shopId: number; poId: string; supplierName: string; isActive?: boolean }
): Promise<void> {
  const { shopId, poId, supplierName, isActive = true } = params;
  const poShort = poId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:receive:arrived:${poId}`,
    alertType:  'wms_receive_arrived',
    severity:   'info',
    title:      'Shipment arrived — receive required',
    message:    `PO ${poShort} from ${supplierName} is marked shipped. Open a receive session to process inbound stock.`,
    entityId:   poId,
    entityType: 'purchase_order',
    isActive,
    category:   'supplier_inbound',
    audience:   'operator',
  });

  if (isActive) {
    dispatchNotification({
      shopId,
      payload: {
        title: 'Shipment arrived',
        body:  `PO ${poShort} from ${supplierName} ready to receive.`,
        data:  { route: '/wms', poId },
      },
      broadcastToRole: 'operator',
    }).catch((err) => console.error('[WMS_RECEIVE_ARRIVED_PUSH_FAILED]', err.message));
  }

  console.info('[WMS_RECEIVE_ARRIVED_ALERT_FIRED]', { shopId, poId, isActive });
}

// ─────────────────────────────────────────
// Receive Inspection Exception (FEAT-004)
// category: supplier_inbound | audience: owner (operator cannot self-resolve)
// ─────────────────────────────────────────

export async function fireReceiveExceptionAlert(
  trx: Knex.Transaction,
  params: { shopId: number; receiveJobId: string; lasyncroVariantId: string; exceptionType: string }
): Promise<void> {
  const { shopId, receiveJobId, lasyncroVariantId, exceptionType } = params;
  const jobShort = receiveJobId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:receive:exception:${receiveJobId}:${lasyncroVariantId}`,
    alertType:  'wms_receive_exception',
    severity:   'warning',
    title:      'Receive exception reported',
    message:    `Job ${jobShort}: ${exceptionType} exception on variant ${lasyncroVariantId.slice(0, 8)}.`,
    entityId:   receiveJobId,
    entityType: 'receive_job',
    isActive:   true,
    category:   'supplier_inbound',
    audience:   'owner',
  });

  console.info('[WMS_RECEIVE_EXCEPTION_ALERT_FIRED]', { shopId, receiveJobId, lasyncroVariantId, exceptionType });
}

// ─────────────────────────────────────────
// Batch Released (pick job created)
// category: warehouse_floor | audience: operator
// ─────────────────────────────────────────

export async function fireBatchReleasedAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    batchId: string;
    orderCount: number;
    lineItems: number;
    assignedOperatorId?: number | null;
  }
): Promise<void> {
  const { shopId, batchId, orderCount, lineItems, assignedOperatorId } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey:   `wms:batch:released:${batchId}`,
    alertType:  'wms_batch_released',
    severity:   'info',
    title:      `Pick batch released — ${orderCount} order${orderCount > 1 ? 's' : ''}`,
    message:    `Batch ${batchShort} is ready to pick (${lineItems} line items). ${assignedOperatorId ? 'Assigned to operator.' : 'Available to any operator.'}`,
    entityId:   batchId,
    entityType: 'pick_batch',
    isActive:   true,
    category:   'warehouse_floor',
    audience:   'operator',
  });

  console.info('[WMS_BATCH_RELEASED_ALERT_FIRED]', { shopId, batchId, orderCount, lineItems, assignedOperatorId });
}