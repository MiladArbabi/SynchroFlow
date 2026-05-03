// apps/backend/src/services/wms/idleAlert.service.ts
import db from '@lasyncro/backend-core/db.js';

/**
 * WMS IDLE ALERT SERVICE (WM-17)
 * --------------------------------
 * Fires alerts when a pick or pack operator has been inactive
 * beyond the shop's configured idle_alert_threshold_minutes.
 *
 * Alert keys are deterministic per operator per session type:
 * - wms:idle:pick:{userId}
 * - wms:idle:pack:{userId}
 *
 * Alerts auto-resolve when:
 * - Operator resumes activity (pick_last_activity_at updated)
 * - Batch is completed or cancelled
 *
 * Called by: wms.idle.alert.worker.ts on a polling interval.
 *
 * Reads shop_wms_settings.idle_alert_threshold_minutes per shop.
 * Uses systemQuery — bypasses RLS for cross-tenant worker access.
 */

export async function runIdleAlertCycle(): Promise<void> {
  // 1. Load all shops with active pick or pack sessions
  const activeShops = await db('pick_batches')
    .whereIn('status', ['picking', 'packing'])
    .distinct('shop_id')
    .select('shop_id');

  if (activeShops.length === 0) return;

  for (const { shop_id } of activeShops) {
    try {
      await processShopIdleAlerts(shop_id);
    } catch (error) {
      console.error('[WMS_IDLE_ALERT] shop cycle failed', {
        shopId: shop_id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}

async function processShopIdleAlerts(shopId: number): Promise<void> {
  // 2. Load idle threshold for this shop
  const settings = await db('shop_wms_settings')
    .where({ shop_id: shopId })
    .select('idle_alert_threshold_minutes')
    .first();

  if (!settings) return;

  const thresholdMs = settings.idle_alert_threshold_minutes * 60 * 1000;
  const now = Date.now();

  // 3. Find active picking batches past idle threshold
  const pickingBatches = await db('pick_batches')
    .where({ shop_id: shopId, status: 'picking' })
    .whereNotNull('pick_last_activity_at')
    .whereNotNull('picked_by')
    .select('pick_batch_id', 'picked_by', 'pick_last_activity_at');

  for (const batch of pickingBatches) {
    const idleMs = now - new Date(batch.pick_last_activity_at).getTime();
    const isIdle = idleMs > thresholdMs;
    const alertKey = `wms:idle:pick:${batch.picked_by}`;
    const idleMinutes = Math.round(idleMs / 60_000);

    await upsertIdleAlert({
      shopId,
      alertKey,
      isActive: isIdle,
      userId: batch.picked_by,
      batchId: batch.pick_batch_id,
      stage: 'pick',
      idleMinutes,
    });
  }

  // 4. Find active packing batches past idle threshold
  const packingBatches = await db('pick_batches')
    .where({ shop_id: shopId, status: 'packing' })
    .whereNotNull('pack_last_activity_at')
    .whereNotNull('packed_by')
    .select('pick_batch_id', 'packed_by', 'pack_last_activity_at');

  for (const batch of packingBatches) {
    const idleMs = now - new Date(batch.pack_last_activity_at).getTime();
    const isIdle = idleMs > thresholdMs;
    const alertKey = `wms:idle:pack:${batch.packed_by}`;
    const idleMinutes = Math.round(idleMs / 60_000);

    await upsertIdleAlert({
      shopId,
      alertKey,
      isActive: isIdle,
      userId: batch.packed_by,
      batchId: batch.pick_batch_id,
      stage: 'pack',
      idleMinutes,
    });
  }
}

async function upsertIdleAlert({
  shopId,
  alertKey,
  isActive,
  userId,
  batchId,
  stage,
  idleMinutes,
}: {
  shopId: number;
  alertKey: string;
  isActive: boolean;
  userId: number;
  batchId: string;
  stage: 'pick' | 'pack';
  idleMinutes: number;
}): Promise<void> {
  const title = `Operator idle during ${stage}`;
  const message = `Operator has been inactive for ${idleMinutes} minute${idleMinutes !== 1 ? 's' : ''} on batch ${batchId.slice(0, 8).toUpperCase()}.`;

  await db.raw(`
    INSERT INTO alerts (
      shop_id, alert_key, source, alert_type, severity,
      title, message, entity_id, entity_type,
      revenue_impact, is_active, dismissed_at
    ) VALUES (
      ?, ?, 'wms', 'wms_operator_idle', 'warning',
      ?, ?, ?, 'pick_batch',
      NULL, ?, ?
    )
    ON CONFLICT (shop_id, alert_key) DO UPDATE SET
      is_active = EXCLUDED.is_active,
      title = EXCLUDED.title,
      message = EXCLUDED.message,
      updated_at = CURRENT_TIMESTAMP,
      dismissed_at = CASE
        WHEN EXCLUDED.is_active = false THEN CURRENT_TIMESTAMP
        ELSE alerts.dismissed_at
      END
  `, [
    shopId, alertKey,
    title, message, batchId,
    isActive, isActive ? null : new Date(),
  ]);

  if (isActive) {
    console.warn('[WMS_IDLE_ALERT_FIRED]', { shopId, alertKey, stage, userId, batchId, idleMinutes });
  }
}