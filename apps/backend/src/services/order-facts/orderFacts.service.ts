import db from 'api-db';
import { OrderFactsSnapshot, OrderFactsPeriod } from './orderFacts.types';

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
  period: OrderFactsPeriod
): Promise<OrderFactsSnapshot> {
  // --- Orders observed ---
  const ordersRow = await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .count<{ count: string }>('canonical_order_id as count')
    .first();

  const ordersObserved =
    ordersRow?.count !== undefined ? Number(ordersRow.count) : null;

  // --- Revenue + cost totals ---
  const totalsRow = await db('canonical_orders')
  .where('shop_id', shopId)
  .andWhere('order_created_at', '>=', period.from)
  .andWhere('order_created_at', '<=', period.to)
  .select(
    db.raw('SUM(total_revenue) as revenue'),
    db.raw('SUM(total_cost) as cost')
  )
  .first<{
    revenue: string | null;
    cost: string | null;
  }>();

const revenueTotal =
  totalsRow?.revenue != null ? Number(totalsRow.revenue) : null;

const costTotal =
  totalsRow?.cost != null ? Number(totalsRow.cost) : null;


  // --- Data completeness (FACT, not meaning) ---
  const coverageRow = await db('canonical_order_line_items')
  .where('shop_id', shopId)
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
    period,
    ordersObserved,
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

  console.debug('[OrderFactsService] extracted snapshot', snapshot);

  return snapshot;
}