// apps/backend/src/api/integrations/manualSync.controller.ts

// apps/backend/src/api/integrations/manualSync.controller.ts
//
// MANUAL INITIAL SYNC — LEGACY COMPATIBILITY ALIAS (GH-1101)
//
// PURPOSE:
// - Request durable recovery of an existing integration's initial sync
// - Same contract as POST /sync/:integrationId; never runs sync inline
//
// HARD RULES:
// - Explicit shopId required (must equal the authenticated membership tenant)
// - Explicit integrationId required
// - Delegates to the durable recovery request (no provider call, no inline sync)
// - Fail-fast, fail-closed

import { Request, Response } from 'express';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { respondWithManualRecovery } from './integration.controller.js';

export async function triggerManualInitialSync(
  req: Request,
  res: Response
) {
  try {
    // 🔐 Auth guard (required)
    const { userId, shopId: authenticatedShopId } = requireAuthStrict(req);

    const { shopId: requestedShopId, integrationId: requestedIntegrationId } = req.body ?? {};

    if (!requestedShopId || !requestedIntegrationId) {
      return res.status(400).json({
        error: 'shopId and integrationId are required',
      });
    }

    if (
      !['number', 'string'].includes(typeof requestedShopId) ||
      !['number', 'string'].includes(typeof requestedIntegrationId)
    ) {
      return res.status(400).json({
        error: 'shopId and integrationId must be positive safe integers',
      });
    }

    const requestedShop = Number(requestedShopId);
    const integrationId = Number(requestedIntegrationId);

    if (
      !Number.isSafeInteger(requestedShop) || requestedShop <= 0 ||
      !Number.isSafeInteger(integrationId) || integrationId <= 0
    ) {
      return res.status(400).json({
        error: 'shopId and integrationId must be positive safe integers',
      });
    }

    let shopId: number;
    try {
      ({ shopId } = await requireShopContextForUser(userId));
    } catch {
      return res.status(403).json({ error: 'User shop not found.' });
    }

    if (shopId !== authenticatedShopId || requestedShop !== shopId) {
      return res.status(403).json({ error: 'Shop context mismatch.' });
    }

    // GH-1101: durable recovery admission only; never performInitialSync inline.
    return respondWithManualRecovery(res, shopId, integrationId);
  } catch (err: unknown) {
    console.error('[manualInitialSync] failed', {
      message: err instanceof Error ? err.message : 'unknown',
    });

    return res.status(500).json({ error: 'Failed to request sync.' });
  }
}
