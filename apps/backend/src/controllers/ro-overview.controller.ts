import { Request, Response } from 'express';
import { getOverviewFt2Snapshot } from 'api-src/services/overview-ft2/overviewFt2.resolver';

/**
 * GET /api/v1/modules/overview/ft2
 *
 * RO-Overview FT2 Controller
 * -------------------------
 * Read-only orientation surface.
 *
 * HARD RULES (NON-NEGOTIABLE):
 * - Authenticated
 * - Shop-scoped
 * - NO time ranges
 * - NO lifecycle mutation
 * - NO intelligence
 * - NO FTEP
 * - NO partial truth
 *
 * If the Overview FT2 snapshot cannot be safely composed,
 * this endpoint MUST fail loudly.
 *
 * Silence is enforced at the resolver level — not here.
 */
export async function getOverviewFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const snapshot = await getOverviewFt2Snapshot({
      shopId,
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Overview FT2 unavailable';

    res.status(500).json({ error: message });
  }
}
