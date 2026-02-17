// apps/backend/src/api/trust/trust.ft2.controller.ts

import { Request, Response } from 'express';
import { getTrustFt2Snapshot } from '../../services/trust-ft2/trustFt2.resolver.js';
/**
 * GET /api/v1/modules/trust/ft2
 *
 * Trust FT2 (read-only)
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - Backend-owned period
 * - No lifecycle mutation
 * - No inference
 * - No explanation
 */
export async function getTrustFt2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const snapshot = await getTrustFt2Snapshot({ shopId });

    res.status(200).json(snapshot);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
}