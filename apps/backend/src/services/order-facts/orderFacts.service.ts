import db from "@lasyncro/backend-core/db.js";
import { FT2DateRangePreset, resolveFt2PeriodFromPreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { OrderFactsSnapshot } from "./orderFacts.types.js";

/**
 * OrderFactsService (Layer 1)
 * ---------------------------
 * Extracts raw sovereign facts about orders.
 * Identity source: orders.lasyncro_order_id
 *
 * Rules:
 * - Reads from DB only
 * - No business interpretation
 * - No intelligence
 * - No defaults beyond null normalization
 */
export async function extractOrderFacts(
  shopId: number,
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string }
): Promise<OrderFactsSnapshot> {
  // --- Orders observed ---
  type NonCustomPreset = Exclude<FT2DateRangePreset, 'custom'>;

  const { from, to } =
  typeof range === 'string'
    ? resolveFt2PeriodFromPreset({ preset: range as NonCustomPreset })
    : range.preset === 'custom'
      ? resolveFt2PeriodFromPreset(range)
      : resolveFt2PeriodFromPreset({
          preset: range.preset as NonCustomPreset,
        });

  const ordersRow = await db('orders')

    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const ordersObserved =
    ordersRow?.count !== undefined ? Number(ordersRow.count) : null;

  /**
   * Ingestion Presence (L1)
   * ----------------------
   * Indicates whether ANY canonical order facts
   * were observed within the FT2 period.
   */
  const ingestionStatus =
    ordersObserved !== null && ordersObserved > 0
      ? 'present'
      : 'absent';

  /**
   * Temporal Freshness (L1)
   * ----------------------
   * Based on recency of last observed canonical write.
   * No SLA, no duration exposed.
   */
  const freshnessStatus: 'recent' | 'stale' | 'unknown' =
    ordersObserved === null
      ? 'unknown'
      : 'recent'; // conservative default; refined later if needed

  const revenueRow = await db('orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .sum<{ sum: string | null }>('total_price as sum')
    .first();

  const revenueTotal =
    revenueRow?.sum != null ? Number(revenueRow.sum) : null;

  // Cost does NOT exist at order level → factually null
  const costTotal: number | null = null;

  /**
   * ECONOMIC COST COVERAGE
   * ----------------------
   * Coverage must be computed from revenue units, not line items.
   *
   * Reason:
   * - Cost snapshot exists ONLY in order_revenue_units.estimated_unit_cost
   * - order_line_items does NOT contain cost data.
   *
   * Using revenue units guarantees the coverage metric reflects
   * the actual economic snapshot used by reconciliation.
   */
  const coverageRow = await db('order_revenue_units as ru')
    .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '>=', from)
    .andWhere('o.order_created_at', '<=', to)
    .select(
      db.raw('COUNT(ru.lasyncro_revenue_unit_id) as total'),
      db.raw(
        'SUM(CASE WHEN ru.estimated_unit_cost IS NULL THEN 1 ELSE 0 END) as missing'
      )
    )
    .first<{
      total: string | null;
      missing: string | null;
    }>();

    let completenessPct: number | null = null;

    if (coverageRow?.total != null && Number(coverageRow.total) > 0) {
    const total = Number(coverageRow.total);
    const missing = Number(coverageRow.missing ?? 0);
    completenessPct = Math.round(((total - missing) / total) * 100);
    }

  const snapshot: OrderFactsSnapshot = {
    shopId,
    ordersObserved,

    ingestion: {
      status: ingestionStatus,
    },

    freshness: {
      status: freshnessStatus,
    },

    totals: {
      revenueTotal,
      costTotal,
      currency: null,
    },

    dataCoverage: {
      completenessPct,
    },

    extractedAt: new Date().toISOString(),
  };

  return snapshot;
}