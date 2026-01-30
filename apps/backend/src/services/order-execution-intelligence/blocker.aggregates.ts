import { classifyRevenueBlockers } from './blocker.classifier';

/**
 * aggregateBlockedRevenue (L2)
 * ----------------------------
 * Produces totals ONLY.
 * No per-order leakage.
 * Safe for future FT2 downgrade.
 */
export async function aggregateBlockedRevenue(
  shopId: number
): Promise<{
  totalBlocked: number;
  byCategory: Record<string, number>;
}> {

  const blockers = await classifyRevenueBlockers(shopId);

  const byCategory: Record<string, number> = {};
  let totalBlocked = 0;

  for (const b of blockers) {
    // ─────────────────────────────────────────────
    // Invariant: revenue must be non-negative
    // ─────────────────────────────────────────────
    if (b.revenue < 0) {
      console.warn('[L2:blocker][aggregate] Negative revenue detected', b);
    }

    totalBlocked += b.revenue;

    byCategory[b.category] =
      (byCategory[b.category] ?? 0) + b.revenue;
  }

  // ─────────────────────────────────────────────
  // Sanity: category sum must equal total
  // ─────────────────────────────────────────────
  const categorySum = Object.values(byCategory)
    .reduce((a, b) => a + b, 0);

  if (Math.abs(categorySum - totalBlocked) > 0.01) {
    console.error('[L2:blocker][aggregate] Category sum mismatch', {
      totalBlocked,
      categorySum,
      byCategory,
    });
  }

  // ─────────────────────────────────────────────
  // Debug visibility (DEV ONLY)
  // ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[L2:blocker][aggregate]', {
      totalBlocked,
      byCategory,
      categories: Object.keys(byCategory),
    });
  }

  return { totalBlocked, byCategory };
}
