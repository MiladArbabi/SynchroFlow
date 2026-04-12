// apps/backend/src/services/wms/wmsAlerts.service.ts
import { Knex } from 'knex';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';

/**
 * WMS ALERT SERVICE (WM-21)
 * --------------------------
 * Proactive alert firing for WMS warehouse signals.
 *
 * Alert keys are deterministic — safe to call multiple times:
 * - wms:exception:pick:{batchId}     — pick exception raised
 * - wms:exception:pack:{batchId}     — pack exception raised
 * - wms:stow:pending:{shopId}        — stow task created (auto-resolves on confirm)
 * - wms:batch:ready_to_pack:{batchId} — pick complete, packer needed
 * - wms:batch:ready_to_ship:{batchId} — pack complete, shipment needed
 *
 * All alerts:
 * - Upsert on (shop_id, alert_key) — idempotent
 * - Auto-resolve when underlying condition clears
 * - Visible in AlertsPage to owner/admin roles
 *
 * Caller passes the transaction — alerts are written atomically
 * with the event that triggered them.
 */

type AlertSeverity = 'critical' | 'warning' | 'info';

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
  }
): Promise<void> {
  const {
    shopId,
    alertKey,
    alertType,
    severity,
    title,
    message,
    entityId,
    entityType,
    isActive,
  } = params;

  await trx('alerts')
    .insert({
      shop_id: shopId,
      alert_key: alertKey,
      source: 'wms',
      alert_type: alertType,
      severity,
      title,
      message,
      entity_id: entityId ?? null,
      entity_type: entityType ?? null,
      revenue_impact: null,
      is_active: isActive,
      dismissed_at: isActive ? null : trx.fn.now(),
    })
    .onConflict(['shop_id', 'alert_key'])
    .merge({
      is_active: isActive,
      title: trx.raw('EXCLUDED.title'),
      message: trx.raw('EXCLUDED.message'),
      updated_at: trx.fn.now(),
      ...(isActive === false && { dismissed_at: trx.fn.now() }),
    });
}

// ─────────────────────────────────────────
// Pick/Pack Exception Raised
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
  const typeLabel = exceptionType.replace(/_/g, ' ');

  await upsertWmsAlert(trx, {
    shopId,
    alertKey: `wms:exception:${stage}:${batchId}`,
    alertType: stage === 'pick' ? 'wms_pick_exception' : 'wms_pack_exception',
    severity: 'warning',
    title: `${stageLabel} exception — ${typeLabel}`,
    message: `${stageLabel} exception reported on batch ${batchShort}${variantTitle ? ` for ${variantTitle}` : ''}. Review in SKU Gaps.`,
    entityId: batchId,
    entityType: 'pick_batch',
    isActive: true,
  });

  // Notify owner/admin — exception needs supervisor review
  dispatchNotification({
    shopId,
    payload: {
      title: `${stage === 'pick' ? 'Pick' : 'Pack'} exception reported`,
      body: `Batch ${batchId.slice(0, 8).toUpperCase()} — ${exceptionType.replace(/_/g, ' ')}. Review in SKU Gaps.`,
      data: { route: '/sku-gaps', batchId },
    },
    broadcastToRole: 'owner',
  }).catch((err) => console.error('[WMS_EXCEPTION_PUSH_FAILED]', err.message));

  console.info('[WMS_EXCEPTION_ALERT_FIRED]', { shopId, batchId, stage, exceptionType });
}

// ─────────────────────────────────────────
// Stow Task Created / Resolved
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
    alertKey: `wms:stow:pending:${stowTaskId}`,
    alertType: 'wms_stow_pending',
    severity: 'info',
    title: isActive ? 'Stow task pending' : 'Stow task completed',
    message: isActive
      ? `A stow task was created from ${triggerLabel}. Assign an operator to stow.`
      : `Stow task completed successfully.`,
    entityId: stowTaskId,
    entityType: 'stow_task',
    isActive,
  });

  console.info('[WMS_STOW_ALERT_FIRED]', { shopId, stowTaskId, isActive });
}

// ─────────────────────────────────────────
// Batch Ready to Pack
// ─────────────────────────────────────────

export async function fireBatchReadyToPackAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    batchId: string;
    isActive: boolean;
  }
): Promise<void> {
  const { shopId, batchId, isActive } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey: `wms:batch:ready_to_pack:${batchId}`,
    alertType: 'wms_batch_ready_to_pack',
    severity: 'info',
    title: 'Batch ready to pack',
    message: `Batch ${batchShort} pick is complete. A packer can now claim and start packing.`,
    entityId: batchId,
    entityType: 'pick_batch',
    isActive,
  });

  // Notify operators — packer needed (broadcast to pool)
  if (isActive) {
    dispatchNotification({
      shopId,
      payload: {
        title: 'Batch ready to pack',
        body: `Batch ${batchId.slice(0, 8).toUpperCase()} pick complete. Claim it to start packing.`,
        data: { route: '/wms', batchId },
      },
      broadcastToRole: 'operator',
    }).catch((err) => console.error('[WMS_READY_TO_PACK_PUSH_FAILED]', err.message));
  }

  console.info('[WMS_READY_TO_PACK_ALERT_FIRED]', { shopId, batchId, isActive });
}

// ─────────────────────────────────────────
// Batch Ready to Ship
// ─────────────────────────────────────────

export async function fireBatchReadyToShipAlert(
  trx: Knex | Knex.Transaction,
  params: {
    shopId: number;
    batchId: string;
    isActive: boolean;
  }
): Promise<void> {
  const { shopId, batchId, isActive } = params;
  const batchShort = batchId.slice(0, 8).toUpperCase();

  await upsertWmsAlert(trx, {
    shopId,
    alertKey: `wms:batch:ready_to_ship:${batchId}`,
    alertType: 'wms_batch_ready_to_ship',
    severity: 'info',
    title: 'Batch ready to ship',
    message: `Batch ${batchShort} packing is complete. Orders are ready for ship confirmation.`,
    entityId: batchId,
    entityType: 'pick_batch',
    isActive,
  });

  // Notify owner/admin — ship confirmation needed
  if (isActive) {
    dispatchNotification({
      shopId,
      payload: {
        title: 'Batch ready to ship',
        body: `Batch ${batchId.slice(0, 8).toUpperCase()} packing complete. Confirm shipment.`,
        data: { route: '/wms', batchId },
      },
      broadcastToRole: 'owner',
    }).catch((err) => console.error('[WMS_READY_TO_SHIP_PUSH_FAILED]', err.message));
  }

  console.info('[WMS_READY_TO_SHIP_ALERT_FIRED]', { shopId, batchId, isActive });
}