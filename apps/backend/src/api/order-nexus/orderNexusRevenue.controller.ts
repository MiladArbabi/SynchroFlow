import { resolveFt2RangeFromRequest } from
  'api-src/utils/resolveFt2RangeFromRequest';

import { getExecutionAwareRevenueSnapshot } from
  'api-src/services/order-revenue/orderRevenueExecutionAware.resolver';

// ⬇️ NEW: epistemic adapter (Phase A only)
import { legacyToEpistemic } from
  'packages/epistemic';

/**
 * Order-Nexus Revenue — Phase 6
 * -----------------------------
 * Execution-aware revenue endpoint.
 *
 * ⚠️ EPISTEMIC NOTE (Phase A):
 * ---------------------------
 * This controller is an epistemic boundary.
 * We explicitly wrap returned facts so that:
 *
 * - Knowledge state is explicit
 * - Nulls are no longer ambiguous
 * - Downstream consumers cannot silently suppress data
 *
 * IMPORTANT:
 * - No business logic is changed here
 * - Sufficiency semantics are preserved as-is
 * - Epistemic correctness will be addressed in later phases
 */
export default async function orderNexusRevenuePhase6Controller(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;
  const mode = req.query.mode;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (mode !== 'execution_aware') {
    return res.status(400).json({
      error: 'Invalid mode',
      allowed: ['execution_aware'],
    });
  }

  const range = resolveFt2RangeFromRequest(req);

  const snapshot = await getExecutionAwareRevenueSnapshot({
    shopId,
    range,
  });

  /**
   * Epistemic wrapping (Phase A)
   * ----------------------------
   * We preserve the existing shape and meaning of the snapshot,
   * but wrap numeric facts so their epistemic state is explicit.
   *
   * Mapping rule (temporary):
   * - value !== null → KNOWN
   * - value === null → UNKNOWN
   *
   * This is intentionally naive.
   */
  return res.json({
    ...snapshot,

    revenue: {
      fulfilled: legacyToEpistemic(snapshot.revenue.fulfilled),
      unfulfilled: legacyToEpistemic(snapshot.revenue.unfulfilled),
      unknown: legacyToEpistemic(snapshot.revenue.unknown),
    },
  });
}
