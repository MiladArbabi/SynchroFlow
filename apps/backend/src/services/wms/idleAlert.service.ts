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

  /**
   * OV-154: resolution sweep for completed and cancelled batches.
   * Steps 3 and 4 only scan status IN ('picking','packing'), so once a batch
   * leaves those states its alert key is never passed to upsertIdleAlert
   * again — not even with isActive:false. The row stays is_active=true
   * indefinitely and the Overview footer keeps rendering its frozen message.
   * Observed on prod: wms:idle:pick:1 stranded on a pick_complete batch,
   * updated_at ~2 days old, still displayed. The header has always claimed
   * "alerts auto-resolve when the batch is completed or cancelled"; this is
   * the code that makes it true. Keyed on entity_id, so only alerts whose
   * own batch is inactive are touched.
   */
  const stranded = await db('alerts')
    .where({ shop_id: shopId, alert_type: 'wms_operator_idle', is_active: true })
    .whereIn(
      'entity_id',
      db('pick_batches')
        .where({ shop_id: shopId })
        .whereNotIn('status', ['picking', 'packing'])
        // alerts.entity_id is varchar, pick_batches.pick_batch_id is uuid.
        // Postgres has no varchar = uuid operator, so the subquery must
        // return text. Cast here rather than on entity_id: casting the
        // left side would defeat any index on it.
        .select(db.raw('pick_batch_id::text'))
    )
    .update({
      is_active: false,
      dismissed_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('alert_key');

  if (stranded.length > 0) {
    console.warn('[WMS_IDLE_ALERT_STRANDED_RESOLVED]', {
      shopId,
      count: stranded.length,
      alertKeys: stranded.map((r) => r.alert_key),
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

  const result = await db.raw(`
    WITH previous AS (
      SELECT is_active FROM alerts WHERE shop_id = ? AND alert_key = ?
    )
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
    RETURNING (SELECT is_active FROM previous) AS previous_is_active
  `, [
    shopId, alertKey,
    shopId, alertKey,
    title, message, batchId,
    isActive, isActive ? null : new Date(),
  ]);

  // WM-ALERT-01: only log on inactive→active transition, not every poll cycle.
  // Previously logged on every 60s cycle while a batch stayed idle (observed
  // 5000+ consecutive identical log lines for one stale batch).
  const previousIsActive = result.rows?.[0]?.previous_is_active;
  if (isActive && previousIsActive !== true) {
    console.warn('[WMS_IDLE_ALERT_FIRED]', { shopId, alertKey, stage, userId, batchId, idleMinutes });
  }
}