//apps/backend/src/api/activation/activation.controller.ts

/**
 * Activation Verdict Controller
 * -----------------------------
 * - IO-only layer
 * - Delegates ALL decision logic to shared pure derivation functions
 * - Writes authoritative audit events
 *
 * IMPORTANT:
 * - Do NOT introduce new verdict states here
 * - Do NOT duplicate derivation logic
 * - If a state is missing, it belongs in shared/activation/types.ts
 */

import { Request, Response } from 'express';
import db from 'api-src/db';
import crypto from 'crypto';

import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import {
  ActivationVerdict,
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

  /**
   * Activation Audit Record
   * -----------------------
   * This write is the authoritative, append-only history of:
   * - why a user was blocked or activated
   * - what backend truth existed at evaluation time
   *
   * Guarantees:
   * - deterministic (pure derivation inputs)
   * - reproducible (stored snapshots)
   * - supportable (human-readable reason)
   *
   * DO NOT:
   * - add frontend-derived fields
   * - mutate derivation logic here
   */
  const auditPayload = {
    identity,
    integrations,
    entitlements,
    ft0Phase,
  };

  await db('activation_audit_events').insert({
    user_id: userId,
    shop_id: shopId,
    entry_channel: entryChannel,
    verdict: verdict.verdict,
    reason:
      verdict.verdict === 'BLOCKED'
        ? verdict.reason
        : verdict.verdict === 'PENDING'
          ? verdict.reason
          : null,

    payload: auditPayload,
  });

  console.info(
    JSON.stringify({
      event: 'activation.verdict.evaluated',
      userId,
      shopId,
      entryChannel,
      verdict: verdict.verdict,
      ft0Phase,
      timestamp: new Date().toISOString(),
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
    ft0: {
      phase: ft0Phase,
    },
    verdict,
  });
};