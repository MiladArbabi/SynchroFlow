// apps/backend/src/api/products/products.ft2.controller.ts
import { Request, Response } from 'express';
import { getProductsFt2Snapshot } from 'api-src/services/products-ft2.provider';

/**
 * GET /api/v1/products/ft2
 *
 * FT2 read-only exposure for Products / SKU-OS.
 *
 * Rules:
 * - No lifecycle mutation
 * - No intelligence
 * - No explanations
 * - Lifecycle gating handled by provider
 */
export async function getProductsFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId =
      Number(req.headers['x-test-shop-id']) ||
      Number((req as any).shopId);

    if (!shopId) {
      res.status(400).json({ error: 'Missing shopId' });
      return;
    }

    const { from, to } = req.query;

    const snapshot = await getProductsFt2Snapshot({
      shopId,
      period: {
        from: String(from),
        to: String(to),
      },
    });

    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}
