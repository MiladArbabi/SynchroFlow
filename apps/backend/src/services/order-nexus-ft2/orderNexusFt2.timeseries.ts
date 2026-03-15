import db from '@lasyncro/backend-core/db.js';
import { FT2RangeInput, resolveFt2Range } from '@lasyncro/backend-core/utils/ft2Period.js';

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
}: {
  shopId: number;
  range: FT2RangeInput;
}) {
  const resolvedRange = resolveFt2Range(range);

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