import db from 'api-db';
import { FT2RangeInput, resolveFt2Range } from 'api-src/utils/ft2Period';

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
  }: {
    shopId: number;
    range: FT2RangeInput;
  }
): Promise<OrdersFt2Coverage> {
  const { from, to } = resolveFt2Range(range);

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
  const row = await db('order_revenue_units')
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