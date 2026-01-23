// apps/backend/src/api/customers/customers.ft2.controller.ts
import { Request, Response } from 'express';
import { getCustomersFt2Snapshot } from 'api-src/services/customers-ft2.provider';
import {
  FT2DateRangePreset,
  resolveFt2Range,
} from 'api-src/utils/ft2Period';

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

    const preset =
    req.query.preset as FT2DateRangePreset | undefined;

    /**
     * FT2 period resolution
     * --------------------
     * Backend is authoritative.
     * All semantics live in ft2Period util.
     */
    const period = resolveFt2Range(
      req.query.preset === 'custom'
        ? {
            preset: 'custom',
            from: String(req.query.from),
            to: String(req.query.to),
          }
        : (req.query.preset as FT2DateRangePreset | undefined) ??
            'past_30_days'
    );

  const snapshot = await getCustomersFt2Snapshot({
    shopId,
    period,
  });

    res.status(200).json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}