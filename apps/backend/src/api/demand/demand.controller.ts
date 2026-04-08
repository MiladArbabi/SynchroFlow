// apps/backend/src/api/demand/demand.controller.ts

import { Request, Response } from 'express';
import { computeDemandIntelligence } from '../../services/demand/demandIntelligence.service.js';

/**
 * GET /api/v1/modules/demand
 * ---------------------------
 * Returns demand velocity, days-of-stock, and reorder signals per variant.
 */
export const httpGetDemand = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const result = await computeDemandIntelligence(shopId);
    return res.status(200).json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DEMAND_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch demand intelligence: ${message}` });
  }
};