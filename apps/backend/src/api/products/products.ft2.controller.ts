import { Request, Response } from 'express';
import { getProductsFt2Snapshot } from 'api-src/services/products-ft2.provider';
import { getFt2Period } from 'api-src/utils/ft2Period';

/**
 * GET /api/v1/modules/products/ft2
 *
 * FT2 read-only exposure for Products.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - No lifecycle mutation
 * - No intelligence
 * - No explanations
 */
export async function getProductsFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const period = getFt2Period();

    const snapshot = await getProductsFt2Snapshot({
      shopId,
      period,
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}