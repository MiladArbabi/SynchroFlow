import db from '@lasyncro/backend-core/db.js';
import { BlockerClassification } from './blocker.types.js';

/**
 * classifyRevenueBlockers (L2 — INTERNAL ONLY)
 * -------------------------------------------
 * Purpose:
 * - Classify WHY revenue is not converting yet.
 * - Produce exactly ONE blocker category per unfulfilled order.
 *
 * CRITICAL RULES (LOCKED):
 * -----------------------
 * 1. Classification is PRIORITY-ORDERED (first match wins)
 * 2. Categories are MUTUALLY EXCLUSIVE
 * 3. This layer is READ-ONLY intelligence
 * 4. NO writes, NO side effects, NO UI semantics
 *
 * PRIORITY ORDER (HIGHEST → LOWEST):
 * ---------------------------------
 * 1. missing_execution     → no observed execution truth
 * 2. stalled_execution     → observed but stalled beyond threshold
 * 3. awaiting_fulfillment  → normal, recent work-in-progress
 * 4. unknown               → safety fallback only
 *
 * This output:
 * - MUST NOT surface directly to FT2
 * - MAY ONLY be aggregated + downgraded later
 */

export async function classifyRevenueBlockers(
  shopId: number
): Promise<BlockerClassification[]> {

/**
 * SOVEREIGN CLASSIFIER ANCHOR (v2)
 * --------------------------------
 * - UUID-anchored via lasyncro_order_id
 * - shop_id derived from orders
 * - Revenue primitive: quantity * unit_price
 */
const rows = await db('order_fulfillment_status as f')
  .join(
    'orders as o',
    'o.lasyncro_order_id',
    'f.lasyncro_order_id'
  )
  .join(
    'order_revenue_units as ru',
    'ru.lasyncro_order_id',
    'f.lasyncro_order_id'
  )
  .where('o.shop_id', shopId)
  .whereNotIn('f.status', ['fulfilled'])
  .select(
    'f.lasyncro_order_id',
    'f.execution_source',
    'f.status_updated_at'
  )
  .sum<{ total_revenue: string | null }>(
    db.raw('(ru.quantity * ru.unit_price)')
  )
  .groupBy(
    'f.lasyncro_order_id',
    'f.execution_source',
    'f.status_updated_at'
  );

  const now = Date.now();

    return rows.map((r) => {
    // ─────────────────────────────────────────────
    // Invariant Assertions (DEV-SAFE)
    // ─────────────────────────────────────────────
    if (!r.lasyncro_order_id) {
      console.warn('[L2:blocker] Missing lasyncro_order_id', r);
    }

    if (r.total_revenue == null) {
      console.warn('[L2:blocker] Missing total_price', {
        lasyncroOrderId: r.lasyncro_order_id,
      });
    }

    if (!r.status_updated_at) {
      console.warn('[L2:blocker] Missing status_updated_at', {
        lasyncroOrderId: r.lasyncro_order_id,
      });
    }

    const ageMs = now - new Date(r.status_updated_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    let category: BlockerClassification['category'] = 'unknown';

    // NOTE:
    // Synthetic execution is identified by execution_source.
    // execution_confidence is deprecated and no longer authoritative.
    // ─────────────────────────────────────────────
    // PRIORITY 1 — Missing Execution Truth
    // ─────────────────────────────────────────────
    if (r.execution_source === 'synthetic') {
      category = 'missing_execution';
    }

    // ─────────────────────────────────────────────
    // PRIORITY 2 — Stalled Execution
    // ─────────────────────────────────────────────
    else if (ageDays > 7) {
      category = 'stalled_execution';
    }

    // ─────────────────────────────────────────────
    // PRIORITY 3 — Normal Work-in-Progress
    // ─────────────────────────────────────────────
    else {
      category = 'awaiting_fulfillment';
    }

    // ─────────────────────────────────────────────
    // DEBUG TRACE (SAFE — NO SIDE EFFECTS)
    // ─────────────────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[L2:blocker:classified]', {
        lasyncroOrderId: r.lasyncro_order_id,
        category,
        ageDays: Number(ageDays.toFixed(2)),
        revenue: Number(r.total_revenue ?? 0),
        execution_source: r.execution_source,
      });
    }

    return {
      lasyncroOrderId: r.lasyncro_order_id,
      category,
      revenue: Number(r.total_revenue ?? 0),
    };
  });
}
