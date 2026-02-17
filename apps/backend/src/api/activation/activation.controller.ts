//apps/backend/src/api/activation/activation.controller.ts

/**
 * Activation verdict endpoint is strictly read-only.
 * No audit events are emitted here.
 *
 * If activation auditing is required,
 * it must occur in a dedicated write workflow,
 * never in a read surface.
 */

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

import {
  deriveActivationVerdict,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot
} from '@lasyncro/shared/activation';
import { buildActivationSurface } from './activation.surface.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { resolveShopIdForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';

export const getActivationVerdict = async (req: Request, res: Response) => {
  const userId: number | null = (req as any).user?.userId ?? null;

  // --- Identity ---
  let entryChannel: 'SHOPIFY_APP' | 'WEB' | null = null;
  let shopId: number | null = null;

  if (userId) {
    // Resolve shop context (authoritative)
    shopId = await resolveShopIdForUser(userId);

    // entry_channel is USER-level, not shop-level
    const user = await db('users')
      .where({ id: userId })
      .first('entry_channel');

    entryChannel = user?.entry_channel ?? null;
  }

  // NOTE: role intentionally excluded from IdentitySnapshot (Activation v1)
  // Role-based activation will be introduced in v2
  const identity: IdentitySnapshot = { userId, shopId, entryChannel };

  // --- Integrations ---
  let integrations: IntegrationSnapshot[] = [];

  if (shopId) {
    const rows = await db('integrations')
      .where({ shop_id: shopId })
      .select('platform', 'sync_status');

    integrations = rows.map((row: any) => ({
      platform: row.platform,
      syncStatus: row.sync_status,
    }));
  }

  // --- Entitlements ---
  let entitlements: EntitlementSnapshot[] = [];

  if (userId) {
    const snapshot = await EntitlementsService.getForUser(userId);
    if (snapshot?.modules) {
      entitlements = snapshot.modules.map((moduleKey: string) => ({
        moduleKey,
        enabled: true,
      }));
    }
  };

  /**
   * IMPORTANT:
   * Activation verdict endpoint is STRICTLY read-only.
   * It must not mutate readiness, lifecycle, or entitlements.
   *
   * FT0 completion must be triggered by:
   * - Sync completion pipeline
   * - First insight delivery
   * - Explicit readiness workflow
   *
   * Never from a read surface.
   */

  // --- Pure activation derivation ---
  const verdict = deriveActivationVerdict({
    identity,
    integrations,
    entitlements,
  });

  // --- Activation UI surface ---
  const activationSurface = buildActivationSurface({
    verdict,
  });

  console.info(
    JSON.stringify({
      event: 'activation.verdict.evaluated',
      userId,
      shopId,
      entryChannel,
      verdict: verdict.verdict,
      traceId: crypto.randomUUID(),
    })
  );

  // --- Response ---
  res.json({
    meta: {
      userId,
      shopId,
      entryChannel,
      evaluatedAt: new Date().toISOString(),
    },
    verdict,            // kept temporarily
    activationSurface,  // ✅ frontend must consume this
  });
};