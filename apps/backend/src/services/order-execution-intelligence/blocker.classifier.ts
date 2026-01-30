import db from 'api-src/db';
import { BlockerClassification } from './blocker.types';

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

  const rows = await db('order_fulfillment_status as f')
    .join('canonical_orders as o', 'o.canonical_order_id', 'f.canonical_order_id')
    .where('o.shop_id', shopId)
    .whereNotIn('f.status', ['fulfilled', 'delivered'])
    .select(
      'f.canonical_order_id',
      'f.execution_source',
      'f.execution_confidence',
      'f.status_updated_at',
      'o.total_price'
    );

  const now = Date.now();

    return rows.map((r) => {
    // ─────────────────────────────────────────────
    // Invariant Assertions (DEV-SAFE)
    // ─────────────────────────────────────────────
    if (!r.canonical_order_id) {
      console.warn('[L2:blocker] Missing canonical_order_id', r);
    }

    if (r.total_price == null) {
      console.warn('[L2:blocker] Missing total_price', {
        canonicalOrderId: r.canonical_order_id,
      });
    }

    if (!r.status_updated_at) {
      console.warn('[L2:blocker] Missing status_updated_at', {
        canonicalOrderId: r.canonical_order_id,
      });
    }

    const ageMs = now - new Date(r.status_updated_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    let category: BlockerClassification['category'] = 'unknown';

    // ─────────────────────────────────────────────
    // PRIORITY 1 — Missing Execution Truth
    // ─────────────────────────────────────────────
    if (r.execution_source === 'synthetic' && r.execution_confidence === 'assumed') {
      category = 'missing_execution';
    }

        /**
     * ─────────────────────────────────────────────
     * FUTURE HARD BLOCKERS (DISABLED — RESERVED)
     * ─────────────────────────────────────────────
     *
     * These categories are intentionally NOT active yet.
     * They reserve semantic space so future signals do not
     * collapse into existing buckets.
     *
     * IMPORTANT:
     * - These will ALWAYS outrank stalled_execution
     * - They represent external dependency deadlocks
     * - Activation requires new canonical fact tables
     *
     * Planned categories (DO NOT ENABLE YET):
     *
     * inventory_blocked:
     * - SKU unavailable or zero allocatable stock
     * - Requires canonical_inventory_levels
     *
     * shipping_blocked:
     * - Shipment cannot be created or handed off
     * - Requires canonical_shipments / carrier handoff facts
     *
     * customer_blocked:
     * - Explicit customer action required (confirmation, address fix)
     * - Requires customer_interaction_facts
     *
     * payment_blocked (NON-FT2, FUTURE MODULE):
     * - Included here ONLY to forbid accidental leakage
     * - Payment semantics NEVER surface in Orders FT2
     */


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
        canonicalOrderId: r.canonical_order_id,
        category,
        ageDays: Number(ageDays.toFixed(2)),
        revenue: Number(r.total_price),
        execution_source: r.execution_source,
        execution_confidence: r.execution_confidence,
      });
    }

    return {
      canonicalOrderId: r.canonical_order_id,
      category,
      revenue: Number(r.total_price),
    };
  });

}
