/**
 * SERVICE IMPORTS
 * ---------------
 * Explicit separation of fact surfaces.
 *
 * distribution → categorical breakdown
 * coverage → operational coverage metrics
 *
 * NOTE:
 * Never reuse services across fact surfaces.
 * Each endpoint must map 1:1 to its projection service.
 */
import { getOrderNexusFt2Distribution } from '../../services/order-nexus-ft2/orderNexusFt2.distribution.js';
import { getOrderNexusFt2Coverage } from '../../services/order-nexus-ft2/orderNexusFt2.coverage.js';
import { getOrderNexusFt2Timeseries } from '../../services/order-nexus-ft2/orderNexusFt2.timeseries.js';
import { FT2DateRangePreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { resolveFt2RangeFromRequest } from "../../utils/resolveFt2RangeFromRequest.js";

/**
 * Order-Nexus FT2 Facts Controller
 * --------------------------------
 * Read-only fact surfaces.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - Backend-owned period
 * - No lifecycle logic
 * - No intelligence
 */
export async function orderNexusFt2TimeseriesController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // FT2-COVERAGE-CRASH-01: previously unhandled — a query error here
  // crashed the whole dev process instead of returning a clean 500.
  try {
    const tier = req.user?.tier ?? 'starter';
    const range = resolveFt2RangeFromRequest(req);
    const result = await getOrderNexusFt2Timeseries({
      shopId,
      range,
      tier,
    });
    return res.json(result);
  } catch (err: unknown) {
    console.error('[ORDER_NEXUS_FT2_TIMESERIES_FAILED]', { shopId, error: err instanceof Error ? err.message : err });
    return res.status(500).json({ error: 'Failed to load order timeseries' });
  }
}

export async function orderNexusFt2DistributionController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const range = resolveFt2RangeFromRequest(req);
    // FT2-COVERAGE-SWAP-01: this controller was incorrectly calling
    // getOrderNexusFt2Coverage — swapped with orderNexusFt2CoverageController
    // below, likely at initial authorship. Distribution route now calls
    // the distribution service, matching its name/route/response shape.
    const result = await getOrderNexusFt2Distribution({
      shopId,
      range,
    });
    return res.json(result);
  } catch (err: unknown) {
    console.error('[ORDER_NEXUS_FT2_DISTRIBUTION_FAILED]', { shopId, error: err instanceof Error ? err.message : err });
    return res.status(500).json({ error: 'Failed to load order distribution' });
  }
}
export async function orderNexusFt2CoverageController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const tier = req.user?.tier ?? 'starter';
    const range = resolveFt2RangeFromRequest(req);
    /**
     * COVERAGE FACT SURFACE
     * ---------------------
     * Must call coverage projection service.
     * Prevents accidental cross-surface metric leakage.
     */
    const result = await getOrderNexusFt2Coverage({
      shopId,
      range,
      tier,
    });
    return res.json(result);
  } catch (err: unknown) {
    console.error('[ORDER_NEXUS_FT2_COVERAGE_FAILED]', { shopId, error: err instanceof Error ? err.message : err });
    return res.status(500).json({ error: 'Failed to load order coverage' });
  }
}