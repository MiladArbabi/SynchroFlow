// apps/backend/src/api/integrations/refundBackfill.controller.ts

import { Request, Response } from 'express';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { backfillShopifyRefunds } from '../../services/shopify/shopifyRefundBackfill.service.js';

/**
 * POST /api/v1/integrations/refund-backfill
 * ------------------------------------------
 * One-shot historical refund ingestion.
 * Emits domain events for all Shopify refunds not yet in system.
 * Projection engine processes them on next rebuild or live event.
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Idempotent — safe to call multiple times
 * - Does NOT trigger projection — events are queued for normal processing
 */
export async function httpRefundBackfill(req: Request, res: Response) {
  try {
    const authenticatedShopId = req.user?.shopId;

    if (!authenticatedShopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userId } = requireAuthStrict(req);
    let shopId: number;
    try {
      ({ shopId } = await requireShopContextForUser(userId));
    } catch {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    if (shopId !== authenticatedShopId) {
      return res.status(403).json({ error: 'Shop context mismatch.' });
    }

    const result = await backfillShopifyRefunds(shopId);

    return res.status(200).json({
      message: 'Refund backfill complete',
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[REFUND_BACKFILL_ENDPOINT_FAILED]', { error: message });
    return res.status(500).json({ error: message });
  }
}
