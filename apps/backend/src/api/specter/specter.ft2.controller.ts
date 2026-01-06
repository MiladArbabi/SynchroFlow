//apps/backend/src/api/specter/specter.ft2.controller.ts
import { Request, Response } from 'express';
import { getSpecterFt2Snapshot } from 'api-src/services/specter-ft2.provider';

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

    // Canonical FT2 period: last 7 days (matches readiness + specter usage)
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 7);

    const snapshot = await getSpecterFt2Snapshot({
      shopId,
      period: {
        from: from.toISOString(),
        to: now.toISOString()
      }
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}