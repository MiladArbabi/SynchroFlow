import { BlockedRevenueClassification } from './blockedRevenue.classification';
import db from 'api-src/db';

type ExecutionRow = {
  order_id: string;        // platform order id
  status: 'processing' | 'in_transit' | 'delivered' | 'cancelled';
  revenue: number;
};

/**
 * aggregateBlockedRevenue (FT2-safe)
 * ---------------------------------
 * Computes CONSTRAINED blocked revenue only.
 *
 * Definition (v1):
 * - Revenue tied to orders with explicit obligation flags = TRUE
 * - Backlog or non-delivered status is NOT a constraint
 *
 * IMPORTANT:
 * - Absence of constraints MUST return 0 (not backlog)
 * - No default attribution
 * - No coverage-based inference
 *
 * This function is the ONLY source feeding FT2 Obligation Overview.
 */
export async function aggregateBlockedRevenue(
  shopId: number
): Promise<{
  totalBlocked: number;
  byCategory: Record<string, number>;
}> {
  /**
   * v1 constraint: inventory only
   * Future obligation types must be explicit and additive.
   */
  const rows = await db('order_fulfillment_status as ofs')
    .join(
      'canonical_orders as o',
      function () {
        this.on('o.canonical_order_id', '=', 'ofs.canonical_order_id')
            .andOn('o.shop_id', '=', 'ofs.shop_id');
      }
    )
    .where('ofs.shop_id', shopId)
    .where('ofs.has_inventory_block', true)
    .select('o.total_price');

  let constrainedTotal = 0;

  for (const row of rows) {
    const revenue = Number(row.total_price);
    if (!Number.isFinite(revenue)) continue;
    constrainedTotal += revenue;
  }

  /**
   * FT2 exposure rules:
   * - totalBlocked = constrained value only
   * - No category exposure in FT2 v1
   */
  return {
    totalBlocked: constrainedTotal,
    byCategory: {}, // intentionally empty (FT2 forbids attribution)
  };
}

/**
 * Aggregate blocked revenue by obligation category.
 *
 * Rules:
 * - Must account for 100% of blocked value or fail
 * - No best-effort math
 */
export async function classifyBlockedRevenue(
  shopId: number
): Promise<BlockedRevenueClassification> {
  /**
   * IMPORTANT:
   * ----------
   * This classifier reads ONLY from order_fulfillment_status.
   * Missing execution rows are impossible by contract.
   * Synthetic execution is first-class truth.
   */

  const rows: ExecutionRow[] = await db('order_fulfillment_status as ofs')
  .join(
    'canonical_orders as o',
    function () {
      /**
       * NOTE (Inventory v1):
       * --------------------
       * Join is intentionally platform-based.
       * Canonical linkage will be enforced in v2,
       * once obligation attribution is canonical-only.
       */
      this.on('o.platform_order_id', '=', 'ofs.order_id')
        .andOn('o.shop_id', '=', 'ofs.shop_id');
    }
  )
  .where('o.shop_id', shopId)
  .whereNotIn('ofs.status', ['delivered'])
  .select(
    'ofs.order_id',
    'ofs.status',
    'o.total_price as revenue'
  );

  let evaluableRevenue = 0;
  let totalBlockedValue = 0;
  let unknownValue = 0;

  /**
   * Inventory Block v1 invariant:
   * - Every execution row is evaluated
   * - No rows are categorised yet
   * - Coverage may be 100% while classification is 0%
   */
  for (const row of rows) {
    const revenue = Number(row.revenue);

    if (!Number.isFinite(revenue)) {
      continue; // epistemic absence, do not corrupt totals
    }

    totalBlockedValue += revenue;
    evaluableRevenue += revenue;
    unknownValue += revenue;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[L2:inventory][coverage]', {
      totalBlockedValue,
      evaluableRevenue,
      inventoryCoveragePct:
        totalBlockedValue === 0
          ? 1
          : evaluableRevenue / totalBlockedValue,
    });
  }

  const inventoryCoveragePct =
  totalBlockedValue === 0 ? 1 : evaluableRevenue / totalBlockedValue;

  /**
   * Inventory Obligation v1
   * -----------------------
   * Rule:
   * - If inventory coverage is 100%
   * - And no other obligation signals exist
   * - Then all blocked value is inventory-blocked
   */

  /**
   * Inventory Obligation v1 (L2)
   * ---------------------------
   * This is a *default classification*, not an assumption.
   *
   * Preconditions:
   * - Inventory truth evaluated for 100% of blocked revenue
   * - No customer / operational / other signals exist
   *
   * Guarantees:
   * - classifiedPct === 1
   * - unknownValue === 0
   *
   * This enables FT2 obligation downgrade without violating:
   * - Evaluation ≠ Classification
   * - Coverage ≠ Attribution
   */

  const inventoryOnly =
    inventoryCoveragePct === 1 &&
    unknownValue === totalBlockedValue;

  // ─────────────────────────────────────────────
  // Customer Obligation v2 — Coverage signal (epistemic only)
  //
  // NOTE:
  // - This computes *coverage*, not obligation
  // - No attribution is performed here
  // - Presence semantics are derived later by FTEP
  // ─────────────────────────────────────────────
  //
  // Preconditions:
  // - payment_state is a factual column
  // - 'unpaid' is a non-terminal state
  //
  // Guarantees:
  // - No blame
  // - No failure semantics
  // - Absence ≠ paid

  let customerBlocked = 0;
  let customerEvaluable = 0;

  const paymentRows = await db('canonical_orders')
    .where('shop_id', shopId)
    .where('payment_state', '!=', 'unknown')
    .select('payment_state', 'total_price');

  for (const row of paymentRows) {
    const revenue = Number(row.total_price);
    if (!Number.isFinite(revenue)) continue;

    customerEvaluable += revenue;

    if (row.payment_state === 'unpaid') {
      customerBlocked += revenue;
    }
  };

  // Customer obligation coverage (v2)
  // --------------------------------
  // Coverage = % of blocked revenue whose payment_state is observable.
  //
  // NOTE:
  // - This does NOT imply customer blockage
  // - This does NOT affect buckets yet
  // - Used only to prevent future over-classification

  const customerCoveragePct =
    totalBlockedValue === 0
      ? 0
      : customerEvaluable / totalBlockedValue;

  return {
    totalBlockedValue,

    buckets: inventoryOnly
      ? { inventory: totalBlockedValue }
      : {},

    coverage: {
      classifiedPct: inventoryOnly ? 1 : 0,

      // Inventory truth coverage (v1)
      inventoryCoveragePct,

      // Customer truth coverage (v2, non-activating)
      customerCoveragePct,

      // Unattributed blocked revenue
      unknownValue: inventoryOnly ? 0 : unknownValue,
    },
  };
};