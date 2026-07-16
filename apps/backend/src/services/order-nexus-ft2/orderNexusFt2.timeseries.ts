import db from '@lasyncro/backend-core/db.js';
import { FT2RangeInput, resolveFt2Range } from '@lasyncro/backend-core/utils/ft2Period.js';
import type { Tier } from '@lasyncro/backend-core/config/tiers.js';
/**
 * getOrderNexusFt2Timeseries
 * --------------------------
 * Source of truth:
 * orders_operational_control_snapshot
 *
 * Rules
 * - read-only
 * - no inference
 * - deterministic projection passthrough
 */
export async function getOrderNexusFt2Timeseries({
  shopId,
  range,
  tier,
}: {
  shopId: number;
  range: FT2RangeInput;
  tier?: Tier;
}) {
  const resolvedRange = resolveFt2Range(range, tier);

    const rows = await db('orders_operational_control_snapshot')
    .select(
        db.raw("to_char(snapshot_date, 'YYYY-MM-DD') as snapshot_date"),
        'constrained_orders',
        'queue_awaiting_inventory',
        'queue_manual_review',
        'orders_at_sla_risk',
        'revenue_blocked_inventory'
    )
    .where('shop_id', shopId)
    .whereBetween('snapshot_date', [resolvedRange.from, resolvedRange.to])
    .orderBy('snapshot_date', 'asc');

 const normalizedRows = rows.map((r: any) => ({
    ...r,
    revenue_blocked_inventory: Number(r.revenue_blocked_inventory),
 }));

  return {
    period: resolvedRange,
    series: normalizedRows,
  };
}