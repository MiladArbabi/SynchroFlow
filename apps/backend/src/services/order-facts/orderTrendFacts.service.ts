// apps/backend/src/services/order-facts/orderTrendFacts.service.ts
import db from "@lasyncro/backend-core/db.js";
import { FT2DateRangePreset, resolveFt2PeriodFromPreset } from "@lasyncro/backend-core/utils/ft2Period.js";

/**
 * OrderTrendFacts (Layer 1½ — Sovereign Trend Facts)
 * Identity source: orders.lasyncro_order_id
 * --------------------------------------------------
 * Purpose:
  * Provide minimal, fixed-window, non-fabricated inputs
 * required for trend intelligence derivation in Layer 2.
 *
 * Window size is canonical and non-configurable.
 *
 * Guarantees:
 * - DB-only reads
 * - No analytics, no zero-filling
 * - No interpretation or thresholds
 * - Nulls represent epistemic absence
 *
 * This service does NOT:
 * - Classify direction
 * - Infer meaning
 * - Perform comparisons
 */

export interface OrderTrendFacts {
  previousWindowOrders: number | null;
  currentWindowOrders: number | null;

  revenueContinuity:
    | 'isolated'
    | 'continuous'
    | null;
}

const TREND_WINDOW_DAYS = 7;

export async function extractOrderTrendFacts(
  shopId: number,
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string }
): Promise<OrderTrendFacts> {
  type NonCustomPreset = Exclude<FT2DateRangePreset, 'custom'>;

  const { from, to } =
    typeof range === 'string'
      ? resolveFt2PeriodFromPreset({ preset: range as NonCustomPreset })
      : range.preset === 'custom'
        ? resolveFt2PeriodFromPreset(range)
        : resolveFt2PeriodFromPreset({
            preset: range.preset as NonCustomPreset,
          });

  /**
   * Window definition:
   * - currentWindow: last 7 days ending at `to`
   * - previousWindow: 7 days immediately before currentWindow
   *
   * If either window cannot be fully evaluated → null.
   */

  const currentWindowFrom = new Date(to);
  currentWindowFrom.setDate(currentWindowFrom.getDate() - (TREND_WINDOW_DAYS - 1));

  const previousWindowTo = new Date(currentWindowFrom);
  previousWindowTo.setDate(previousWindowTo.getDate() - 1);

  const previousWindowFrom = new Date(previousWindowTo);
  previousWindowFrom.setDate(previousWindowFrom.getDate() - (TREND_WINDOW_DAYS - 1));

  /**
   * Revenue Signal Continuity (L1½)
   * ------------------------------
   * Classifies whether revenue-bearing orders
   * occur on more than one distinct day.
   * No magnitude. No trend.
   */
  const revenueDaysRow = await db('orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', from)
    .andWhere('order_created_at', '<=', to)
    .distinct(db.raw('DATE(order_created_at) as day'));

  const revenueContinuity =
    revenueDaysRow.length > 1
      ? 'continuous'
      : revenueDaysRow.length === 1
        ? 'isolated'
        : null;

  // NOTE:
  // If the database cannot fully evaluate the window,
  // the result MUST be treated as epistemically absent (null).
  async function countOrders(fromDate: Date, toDate: Date): Promise<number | null> {
    const row = await db('orders')
      .where('shop_id', shopId)
      .andWhere('order_created_at', '>=', fromDate.toISOString())
      .andWhere('order_created_at', '<=', toDate.toISOString())
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    return row?.count !== undefined ? Number(row.count) : null;
  }

  const currentWindowOrders = await countOrders(currentWindowFrom, new Date(to));
  const previousWindowOrders = await countOrders(previousWindowFrom, previousWindowTo);

  return {
    previousWindowOrders,
    currentWindowOrders,
    revenueContinuity,
  };
}