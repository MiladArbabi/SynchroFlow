// apps/backend/src/api/customers/customers.ltv.controller.ts

import { Request, Response } from 'express';
import { computeCustomerLtv } from '../../services/customers/customerLtv.service.js';

/**
 * GET /api/v1/modules/customers/ltv
 * -----------------------------------
 * Returns customer LTV intelligence:
 * - Summary: total customers, avg LTV, tier counts
 * - Per-customer: RFM signals, churn risk, tier
 *
 * PRIVACY:
 * - No PII returned — customer_hashed_id only
 * - Guest checkouts excluded
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only
 * - FT2 only
 */
export const httpGetCustomerLtv = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await computeCustomerLtv(shopId);

    return res.status(200).json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CUSTOMER_LTV_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch customer LTV: ${message}`,
    });
  }
};