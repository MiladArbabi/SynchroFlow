import type { Knex } from 'knex';
import { fulfillmentSlaSeconds } from '@lasyncro/shared/contracts/fulfillment-sla';
import { hoursUntilCpt } from '../shop/shopClock.service.js';
import { currentPaidAgeSeconds, currentSlaState, type SlaOrderClock } from './fulfillmentSla.service.js';

type Time = string | Date | null;
type Batch = { pick_batch_id?: string; status: string; released_at?: Time; pick_completed_at?: Time; pack_completed_at?: Time; pick_last_activity_at?: Time; pack_last_activity_at?: Time; picked_by?: number | null };
type Blocker = { constraint_id: string; constraint_type: string; block_type?: string | null; target_id?: string | null };
type Input = { now: Date; order: SlaOrderClock; fulfillmentStatus: string | null; fulfillmentSlaHours?: number | null; timezone: string | null; cptLocal: string | null; idleThresholdMinutes: number | null; requesterId?: number; blockers: Blocker[]; batch: Batch | null; evidenceVersion?: number | null };
type Assessment = 'waiting_for_pick' | 'picking_active' | 'picking_stalled' | 'waiting_for_pack' | 'packing_active' | 'packing_stalled' | 'warehouse_complete';
type Assistance = { kind: 'navigate'; label: string; href: string } | { kind: 'existing_blocker' } | null;

export function assessSlaTreatment(input: Input) {
  const { now, batch, blockers } = input;
  const age = currentPaidAgeSeconds(input.order, now);
  const state = currentSlaState(age, input.fulfillmentSlaHours, input.fulfillmentStatus);
  const terminal = input.fulfillmentStatus === 'fulfilled' || input.fulfillmentStatus === 'cancelled';
  const urgent = state === 'approaching' || state === 'breached';
  let cptState: 'not_configured' | 'before_cutoff' | 'cutoff_reached' | 'unknown' = 'not_configured';
  let hoursRemaining: number | null = null;
  if (input.cptLocal != null) {
    cptState = 'unknown';
    const validTime = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.cptLocal);
    try {
      if (validTime && input.timezone) {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(now);
        hoursRemaining = hoursUntilCpt(input.cptLocal, input.timezone, now);
        cptState = hoursRemaining == null ? 'cutoff_reached' : 'before_cutoff';
      }
    } catch { /* Unknown timezone must not silently imply a UTC pickup. */ }
  }
  let assessment: Assessment | null = null;
  let evidenceIssue: string | null = null;
  let stageStartedAt: Time = null;
  let lastActivityAt: Time = null;
  const validTime = (value: Time | undefined) => value != null && Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() <= now.getTime();
  if (batch && !terminal) {
    if (batch.status === 'pending' || batch.status === 'pick_complete' || batch.status === 'pack_complete') {
      stageStartedAt = batch.status === 'pending' ? batch.released_at ?? null : batch.status === 'pick_complete' ? batch.pick_completed_at ?? null : batch.pack_completed_at ?? null;
      if (validTime(stageStartedAt)) assessment = batch.status === 'pending' ? 'waiting_for_pick' : batch.status === 'pick_complete' ? 'waiting_for_pack' : 'warehouse_complete';
      else evidenceIssue = 'missing_or_invalid_stage_timestamp';
    } else if (batch.status === 'picking' || batch.status === 'packing') {
      lastActivityAt = batch.status === 'picking' ? batch.pick_last_activity_at ?? null : batch.pack_last_activity_at ?? null;
      if (!validTime(lastActivityAt)) evidenceIssue = 'missing_or_invalid_activity';
      else if (input.idleThresholdMinutes == null || !Number.isFinite(input.idleThresholdMinutes) || input.idleThresholdMinutes <= 0) evidenceIssue = 'missing_or_invalid_idle_threshold';
      else {
        const stalled = now.getTime() - new Date(lastActivityAt!).getTime() > input.idleThresholdMinutes * 60000;
        assessment = batch.status === 'picking' ? (stalled ? 'picking_stalled' : 'picking_active') : (stalled ? 'packing_stalled' : 'packing_active');
      }
    } else evidenceIssue = 'batch_not_in_execution';
  }
  const stalled = assessment === 'picking_stalled' || assessment === 'packing_stalled';
  let assistance: Assistance = null;
  if (!terminal) {
    if (blockers.length > 0) {
      if (urgent || stalled) assistance = { kind: 'existing_blocker' };
    } else if (assessment === 'waiting_for_pick' && urgent) assistance = { kind: 'navigate', label: 'Review released batch', href: '/wms' };
    else if (assessment === 'picking_stalled') assistance = input.requesterId != null && batch?.picked_by === input.requesterId && batch.pick_batch_id
      ? { kind: 'navigate', label: 'Continue picking', href: `/wms?batchId=${encodeURIComponent(batch.pick_batch_id)}` }
      : { kind: 'navigate', label: 'Review warehouse work', href: '/wms' };
    else if ((assessment === 'waiting_for_pack' && urgent) || assessment === 'packing_stalled') assistance = { kind: 'navigate', label: 'Open packing', href: '/wms' };
  }
  return {
    assessedAt: now.toISOString(),
    sla: { state, applicable: state != null, ageSincePaidSeconds: age, fulfillmentSlaHours: fulfillmentSlaSeconds(input.fulfillmentSlaHours) / 3600, evidenceVersion: input.evidenceVersion ?? null },
    cpt: { state: cptState, localTime: input.cptLocal, timezone: input.timezone, hoursRemaining },
    execution: { batchId: batch?.pick_batch_id ?? null, batchStatus: batch?.status ?? null, assessment, stageStartedAt, lastActivityAt, idleThresholdMinutes: input.idleThresholdMinutes, evidenceIssue },
    activeBlockerRefs: blockers,
    attentionReasons: terminal ? [] : [...(urgent ? [`sla_${state}`] : []), ...(stalled ? ['execution_stalled'] : [])],
    assistance,
  };
}

export async function buildSlaTreatment(trx: Knex.Transaction, shopId: number, order: SlaOrderClock & { lasyncro_order_id: string }, requesterId?: number) {
  const orderId = order.lasyncro_order_id;
  const [settings, shop, wms, fulfillment, batch, blockers, snapshot, clock] = await Promise.all([
    trx('shop_operational_settings').where({ shop_id: shopId }).first('fulfillment_sla_hours', 'daily_cpt_local'),
    trx('shops').where({ id: shopId }).first('timezone'),
    trx('shop_wms_settings').where({ shop_id: shopId }).first('idle_alert_threshold_minutes'),
    trx('order_fulfillment_status').where({ lasyncro_order_id: orderId }).first('status'),
    trx('pick_batch_orders as pbo').join('pick_batches as pb', 'pb.pick_batch_id', 'pbo.pick_batch_id').where({ 'pbo.shop_id': shopId, 'pb.shop_id': shopId, 'pbo.lasyncro_order_id': orderId }).first('pb.*'),
    trx('order_constraints').where({ lasyncro_order_id: orderId, is_active: true }).orderBy('constraint_id').select('constraint_id', 'constraint_type', 'block_type', 'target_id'),
    trx('order_age_snapshot').where({ lasyncro_order_id: orderId }).orderBy('aggregate_version', 'desc').first('aggregate_version'),
    trx.raw('SELECT NOW() AS now'),
  ]);
  return assessSlaTreatment({ now: new Date(clock.rows[0].now), order, fulfillmentStatus: fulfillment?.status ?? null, fulfillmentSlaHours: settings?.fulfillment_sla_hours, cptLocal: settings?.daily_cpt_local ?? null, timezone: shop?.timezone ?? null, idleThresholdMinutes: wms?.idle_alert_threshold_minutes ?? null, requesterId, batch: batch ?? null, blockers, evidenceVersion: snapshot?.aggregate_version ?? null });
}
