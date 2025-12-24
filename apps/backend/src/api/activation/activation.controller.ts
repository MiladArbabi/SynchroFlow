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

import {
  deriveActivationVerdict,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  ACTIVATION_DERIVATION_VERSION
} from '@lasyncro/shared/activation';

import { EntitlementsService } from 'api-src/services/entitlements.service';
import { buildActivationAuditEvent } from './buildActivationAuditEvent';

import { FT0CompletionService } from 'api-src/services/ft0-completion.service';
import { buildActivationSurface } from './activation.surface';

export const getActivationVerdict = async (req: Request, res: Response) => {
  const userId: number | null = (req as any).user?.userId ?? null;

  // --- Identity ---
  let shopId: number | null = null;
  let entryChannel: 'SHOPIFY_APP' | 'WEB' | null = null;

  if (userId) {
    const user = await db('users')
      .where({ id: userId })
      .first('shop_id', 'entry_channel');

    shopId = typeof user?.shop_id === 'number' ? user.shop_id : null;
    entryChannel = user?.entry_channel ?? null;
  }

  const identity: IdentitySnapshot = { userId, shopId, entryChannel };

  // --- Integrations ---
  let integrations: IntegrationSnapshot[] = [];

    // --- Fact write: FT0 completion (idempotent) ---
  if (shopId) {
    await FT0CompletionService.evaluateAndComplete(shopId);
  }

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
  }

  // --- Fact write: FT0 completion (idempotent, no derivation) ---
  if (shopId) {
    await FT0CompletionService.evaluateAndComplete(shopId);
  }

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

  // --- Audit (must include surface) ---
  const auditEvent = buildActivationAuditEvent({
    derivationVersion: ACTIVATION_DERIVATION_VERSION,
    userId,
    shopId,
    entryChannel,
    identity,
    integrations,
    entitlements,
    verdict,
    activationSurface,
  });

  db('activation_audit_events').insert(auditEvent).catch((err: Error) => {
    console.error(
      JSON.stringify({
        event: 'activation.audit.failed',
        auditEventId: auditEvent.event_id,
        userId,
        shopId,
        error: err?.message,
      })
    );
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