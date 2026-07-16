import { Request, Response } from 'express';
import { getOverviewModulesFt2Snapshot } from '../../services/overview-modules-ft2/overviewModulesFt2.resolver.js';
import { FT2DateRangePreset } from '@lasyncro/backend-core/utils/ft2Period.js';

/**
 * GET /api/v1/modules/overview/modules-ft2
 *
 * Overview Modules FT2 (Ungated)
 * ------------------------------
 * Independent visibility surface for FT2 modules.
 *
 * Responsibilities:
 * - Authenticate request
 * - Resolve FT2 date range (preset or custom)
 * - Delegate to overview-modules resolver
 *
 * Rules:
 * - No trust gating
 * - No aggregation
 * - No inference
 * - Backend owns period resolution
 */
export async function getOverviewModulesFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {

    const shopId = (req as any).user?.shopId;
    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const tier = (req as any).user?.tier ?? 'starter';

    /**
     * FT2 Date Range Resolution
     * ------------------------
     * Canonical FT2 behavior:
     * - Semantic presets (e.g. past_30_days)
     * - Custom ranges via from/to
     * - All logic centralized in ft2Period utils
     */
    const range =
      req.query.preset === 'custom'
        ? ({
            preset: 'custom',
            from: String(req.query.from),
            to: String(req.query.to),
          } as const)
        : ((req.query.preset as FT2DateRangePreset | undefined) ??
            'past_30_days');


    const snapshot = await getOverviewModulesFt2Snapshot({
      shopId,
      range,
      tier,
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Overview Modules FT2 unavailable';

    res.status(500).json({ error: message });
  }
}
