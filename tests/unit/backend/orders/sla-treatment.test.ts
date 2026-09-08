import { assessSlaTreatment } from 'api-src/services/orders/slaTreatmentAssist.service';

const now = new Date('2026-09-08T12:00:00Z');
const base = { now, order: { paid_at: '2026-09-07T15:00:00Z' }, fulfillmentStatus: 'pending', fulfillmentSlaHours: 24, timezone: 'Europe/Stockholm', cptLocal: '16:00', idleThresholdMinutes: 15, requesterId: 7, blockers: [], batch: null };
const assess = (extra: Record<string, unknown> = {}) => assessSlaTreatment({ ...base, ...extra } as any);
it('SLA-TREAT-01 crosses approaching and breach boundaries at read time', () => {
  expect(assess({ now: new Date('2026-09-08T10:59:59Z') }).sla.state).toBe('normal');
  expect(assess({ now: new Date('2026-09-08T11:00:00Z') }).sla.state).toBe('approaching');
  expect(assess({ now: new Date('2026-09-08T15:00:00Z') }).sla.state).toBe('breached');
  expect(assess({ fulfillmentStatus: 'fulfilled' }).sla.state).toBeNull();
  expect(assess({ fulfillmentStatus: 'cancelled' }).sla.state).toBeNull();
  expect(assess({ order: {} }).sla.state).toBeNull();
});
it('SLA-TREAT-01 uses canonical anchor fallback in precedence order', () => {
  expect(assess({ order: { captured_at: base.order.paid_at, order_created_at: '2020-01-01' } }).sla.state).toBe('approaching');
  expect(assess({ order: { order_processed_at: base.order.paid_at } }).sla.state).toBe('approaching');
  expect(assess({ order: { order_created_at: base.order.paid_at } }).sla.state).toBe('approaching');
});
it('SLA-TREAT-01 assesses waiting and completed stages without inventing activity', () => {
  expect(assess({ batch: { status: 'pending', released_at: now } }).execution.assessment).toBe('waiting_for_pick');
  expect(assess({ batch: { status: 'pick_complete', pick_completed_at: now } }).execution.assessment).toBe('waiting_for_pack');
  const complete = assess({ batch: { status: 'pack_complete', pack_completed_at: now } });
  expect(complete.execution.assessment).toBe('warehouse_complete');
  expect(complete.assistance).toBeNull();
});
it('SLA-TREAT-01 uses strictly greater idle threshold and only same-stage activity', () => {
  const exact = new Date(now.getTime() - 15 * 60000);
  const stale = new Date(exact.getTime() - 1);
  expect(assess({ batch: { status: 'picking', pick_last_activity_at: exact, picked_by: 7 } }).execution.assessment).toBe('picking_active');
  const picking = assess({ batch: { pick_batch_id: 'batch-a', status: 'picking', pick_last_activity_at: stale, picked_by: 7 } });
  expect(picking.execution.assessment).toBe('picking_stalled');
  expect(picking.assistance?.href).toBe('/wms?batchId=batch-a');
  expect(assess({ batch: { status: 'picking', pick_last_activity_at: stale, picked_by: 8 } }).assistance?.label).toBe('Review warehouse work');
  expect(assess({ batch: { status: 'packing', pack_last_activity_at: exact } }).execution.assessment).toBe('packing_active');
  expect(assess({ batch: { status: 'packing', pack_last_activity_at: stale } }).execution.assessment).toBe('packing_stalled');
  expect(assess({ batch: { status: 'packing', pick_last_activity_at: stale } }).execution.assessment).toBeNull();
  expect(assess({ idleThresholdMinutes: null, batch: { status: 'picking', pick_last_activity_at: stale } }).execution.assessment).toBeNull();
});
it('SLA-TREAT-01 keeps blockers authoritative and active work unintrusive', () => {
  expect(assess({ blockers: [{ constraint_id: 'c', constraint_type: 'customer' }], batch: { status: 'pending', released_at: now } }).assistance?.kind).toBe('existing_blocker');
  expect(assess({ batch: { status: 'picking', pick_last_activity_at: now } }).assistance).toBeNull();
  expect(assess({ batch: { status: 'pending' } }).assistance).toBeNull();
});
it('SLA-TREAT-01 CPT supplies only truthful today context', () => {
  expect(assess().cpt).toMatchObject({ state: 'before_cutoff', hoursRemaining: 2 });
  expect(assess({ cptLocal: null }).cpt.state).toBe('not_configured');
  expect(assess({ cptLocal: '14:00' }).cpt).toMatchObject({ state: 'cutoff_reached', hoursRemaining: null });
  expect(assess({ cptLocal: '13:00' }).cpt.hoursRemaining).toBeNull();
  expect(assess({ timezone: 'invalid/zone' }).cpt.state).toBe('unknown');
  expect(assess({ cptLocal: '25:00' }).cpt.state).toBe('unknown');
  expect(assess().cpt).not.toHaveProperty('nextPickup');
});
