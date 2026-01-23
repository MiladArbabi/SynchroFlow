//apps/backend/src/api/specter/specter.ft2.controller.ts
import { Request, Response } from 'express';
import { getSpecterFt2Snapshot } from 'api-src/services/specter-ft2.provider';
import { resolveFt2Range } from 'api-src/utils/ft2Period';

/**
 * GET /api/v1/specter/ft2
 *
 * FT2 read-only exposure for Specter.
 *
 * Rules:
 * - No lifecycle mutation
 * - No intelligence
 * - No explanations
 */
export async function httpGetSpecterFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // shopId resolution follows existing test + middleware conventions
    const shopId =
      Number(req.headers['x-test-shop-id']) ||
      Number((req as any).shopId);

    if (!shopId) {
      res.status(400).json({ error: 'Missing shopId' });
      return;
    }

    /**
     * Transport policy:
     * -----------------
     * FT2 requires an explicit observation window.
     * This controller currently applies a fixed 7-day window.
     *
     * IMPORTANT:
     * - This is NOT truth logic.
     * - This does NOT affect FT2 semantics.
     * - Changing this window does not change facts, only observation scope.
     */

    const period = resolveFt2Range(
      (req.query.preset as any) ?? 'past_30_days'
    );

    const snapshot = await getSpecterFt2Snapshot({
      shopId,
      period,
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}