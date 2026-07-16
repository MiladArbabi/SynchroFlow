import db from '@lasyncro/backend-core/db.js';
import { FT2RangeInput, resolveFt2Range } from '@lasyncro/backend-core/utils/ft2Period.js';
import type { Tier } from '@lasyncro/backend-core/config/tiers.js';

export type OrdersFt2Coverage = {
  totalLineItems: number;
  presentCost: number;
  missingCost: number;
  completenessPct: number | null;
};

export async function getOrderNexusFt2Coverage(
  {
    shopId,
    range,
    tier,
  }: {
    shopId: number;
    range: FT2RangeInput;
    tier?: Tier;
  }
): Promise<OrdersFt2Coverage> {
  const { from, to } = resolveFt2Range(range, tier);

    /**
   * Temporal Integrity Rule (FT2)
   * ------------------------------
   * Coverage must be scoped by order_created_at,
   * not line-item insertion time.
   *
   * Rationale:
   * - Prevents ingestion drift
   * - Prevents late-arriving data inflation
   * - Preserves order-window sovereignty
   */
  /**
 * Sovereign FT2 coverage layer
 * -----------------------------
 * Source: order_revenue_units
 *
 * Coverage definition:
 * - totalLineItems = revenue units observed
 * - missingCost = units with NULL estimated_unit_cost
 *
 * No canonical dependency.
 */

  // FT2-COVERAGE-CRASH-01: previous query filtered on shop_id and
  // order_created_at directly on order_revenue_units — neither column
  // exists on this table (schema drift; tenant scope and order date
  // both live on the parent `orders` table, joined via
  // lasyncro_order_id). This crashed the process on any real request,
  // masked until now because a controller swap (see below) routed all
  // production traffic to a stub instead of this function.
  const row = await db('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '>=', from)
    .andWhere('o.order_created_at', '<=', to)
    .select(
      db.raw('COUNT(oru.lasyncro_revenue_unit_id) as total'),
      db.raw(
        'SUM(CASE WHEN oru.estimated_unit_cost IS NULL THEN 1 ELSE 0 END) as missing'
      )
    )
    .first<{
      total: string | null;
      missing: string | null;
    }>();

  const totalLineItems = Number(row?.total ?? 0);
  const missingCost = Number(row?.missing ?? 0);
  const presentCost = totalLineItems - missingCost;

  const completenessPct =
    totalLineItems > 0
      ? Math.round((presentCost / totalLineItems) * 100)
      : null;

  return {
    totalLineItems,
    presentCost,
    missingCost,
    completenessPct,
  };
}