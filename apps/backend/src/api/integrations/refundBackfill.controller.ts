// apps/backend/src/api/integrations/refundBackfill.controller.ts

import { Request, Response } from 'express';
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
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
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