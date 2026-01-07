// apps/backend/src/api/customers/customers.ft2.controller.ts
import { Request, Response } from 'express';
import { getCustomersFt2Snapshot } from 'api-src/services/customers-ft2.provider';

/**
 * GET /api/v1/modules/customers/ft2
 *
 * FT2 read-only exposure for Customers.
 *
 * Rules:
 * - Backend owns period
 * - No lifecycle logic
 * - No mutation
 */

export async function httpGetCustomersFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = (req as any).user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 7);

    const snapshot = await getCustomersFt2Snapshot({
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