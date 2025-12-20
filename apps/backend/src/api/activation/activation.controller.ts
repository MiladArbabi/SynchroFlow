//apps/backend/src/api/activation/activation.controller.ts
import { Request, Response } from 'express';
import db from 'api-src/db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { ActivationVerdict } from '@lasyncro/shared/contracts/activation';
import {
  deriveActivationVerdict,
  deriveFT0Phase,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
} from '@lasyncro/shared/activation';
import { EntitlementsService } from 'api-src/services/entitlements.service';

export const getActivationVerdict = async (req: Request, res: Response) => {
  const userId: number | null = (req as any).user?.userId ?? null;

  // --- Identity resolution ---
  let shopId: number | null = null;
  let entryChannel: 'SHOPIFY_APP' | 'WEB' | null = null;

  if (userId) {
    const user = await db('users')
      .where({ id: userId })
      .first('shop_id', 'entry_channel');

    shopId = typeof user?.shop_id === 'number' ? user.shop_id : null;
    entryChannel = user?.entry_channel ?? null;
  }

  const identity: IdentitySnapshot = {
    userId,
    shopId,
    entryChannel,
  };

  // --- Integration snapshots ---
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

  // --- Entitlement snapshots ---
  let entitlements: EntitlementSnapshot[] = [];

  if (userId) {
    const snapshot = await EntitlementsService.getForUser(userId);

    if (snapshot && Array.isArray(snapshot.modules)) {
      entitlements = snapshot.modules.map((moduleKey: string) => ({
        moduleKey,
        enabled: true,
      }));
    }
  }

  // --- Pure derivation ---
  const ft0Phase = deriveFT0Phase(integrations);

  const verdict = deriveActivationVerdict({
    identity,
    integrations,
    entitlements,
  });

  // --- Response (authoritative, no translation) ---
  res.json({
    meta: {
      userId,
      shopId,
      entryChannel,
      evaluatedAt: new Date().toISOString(),
    },
    ft0: {
      phase: ft0Phase,
    },
    verdict,
  });
};