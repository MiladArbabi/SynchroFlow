import db from 'api-db';
import { OrderFactsSnapshot } from './orderFacts.types';
import { FT2DateRangePreset, resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';

/**
 * OrderFactsService (Layer 1)
 * ---------------------------
 * Extracts raw, canonical facts about orders.
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

  const ordersRow = await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .count<{ count: string }>('canonical_order_id as count')
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

  const revenueRow = await db('canonical_orders')
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
   * Data Coverage (Canonical, Time-Scoped)
   * -------------------------------------
   * Coverage is computed strictly over line items
   * whose order_created_at falls within the same
   * FT2 temporal window as canonical orders.
   *
   * This prevents:
   * - late-arriving line items
   * - orphan temporal drift
   * - visibility inflation
   */
  const coverageRow = await db('canonical_order_line_items')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .select(
      db.raw('COUNT(id) as total'),
      db.raw(
        'SUM(CASE WHEN estimated_unit_cost IS NULL THEN 1 ELSE 0 END) as missing'
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