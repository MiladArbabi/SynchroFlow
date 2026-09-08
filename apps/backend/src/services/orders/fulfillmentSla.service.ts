import { fulfillmentSlaSeconds, approachingFulfillmentSlaLeadSeconds, isApproachingFulfillmentSla } from '@lasyncro/shared/contracts/fulfillment-sla';

// One anchor precedence for projection, read-time assessment and SQL ordering.
const ANCHOR_FIELDS = ['paid_at', 'captured_at', 'order_processed_at', 'order_created_at'] as const;
export type SlaOrderClock = Partial<Record<typeof ANCHOR_FIELDS[number], Date | string | null>>;
export function fulfillmentSlaAnchor(order: SlaOrderClock): Date | string | null {
  return ANCHOR_FIELDS.map(field => order[field]).find(value => value != null) ?? null;
}
export function currentPaidAgeSeconds(order: SlaOrderClock, now: Date): number | null {
  const anchor = fulfillmentSlaAnchor(order);
  if (anchor == null) return null;
  const elapsed = now.getTime() - new Date(anchor).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 1000)) : null;
}
export function currentSlaState(age: number | null, hours: number | null | undefined, status: string | null) {
  if (age == null || status === 'fulfilled' || status === 'cancelled' || status == null) return null;
  if (age >= fulfillmentSlaSeconds(hours)) return 'breached' as const;
  return isApproachingFulfillmentSla({ ageSincePaidSeconds: age, fulfillmentSlaHours: hours }) ? 'approaching' as const : 'normal' as const;
}

// Internal aliases o/ofs only. Thresholds are supplied by the shared contract,
// never separately maintained SQL constants. PostgreSQL NOW is transaction-stable.
export function currentFulfillmentSlaSql(hours: number | null | undefined) {
  const age = `GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(${ANCHOR_FIELDS.map(field => `o.${field}`).join(', ')})))))`;
  const seconds = fulfillmentSlaSeconds(hours);
  const floor = seconds - approachingFulfillmentSlaLeadSeconds(hours);
  const state = `CASE WHEN ofs.status IS NULL OR ofs.status IN ('fulfilled', 'cancelled') THEN NULL WHEN ${age} >= ${seconds} THEN 'breached' WHEN ${age} >= ${floor} THEN 'approaching' ELSE 'normal' END`;
  const rank = `CASE (${state}) WHEN 'breached' THEN 2 WHEN 'approaching' THEN 1 ELSE 0 END`;
  return { age, state, rank, breached: `COALESCE((${state}) = 'breached', false)` };
}
