// apps/backend/src/api/activation/activation.controller.ts

/**
 * Activation Verdict Controller
 * ==============================
 *
 * ROLE (HARD BOUNDARY):
 * - IO-only orchestration layer
 * - Fetches raw snapshots from persistence
 * - Delegates ALL decision logic to shared pure derivations
 *
 * NON-RESPONSIBILITIES (DO NOT VIOLATE):
 * - Must NOT infer FT0 readiness
 * - Must NOT interpret sync or insight states
 * - Must NOT create new verdict logic
 *
 * ARCHITECTURAL INVARIANT:
 * - FT0 completion & readiness are backend-derived and frozen
 * - UI and controller consume, never derive
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import db from 'api-src/db';

import {
  deriveActivationVerdict,
  deriveFT0Phase,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  FT0Phase,
} from '@lasyncro/shared/activation';

import { EntitlementsService } from 'api-src/services/entitlements.service';
import { buildActivationAuditEvent } from './buildActivationAuditEvent';
import { buildActivationSurface } from './activation.surface';

export const getActivationVerdict = async (req: Request, res: Response) => {
  const traceId = crypto.randomUUID();

  /**
   * --------------------------------------------------------------------------
   * 1. Identity Snapshot (authoritative, IO-only)
   * --------------------------------------------------------------------------
   */
  const userId: number | null = (req as any).user?.userId ?? null;

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

  /**
   * --------------------------------------------------------------------------
   * 2. Integration Snapshot (raw sync state only)
   * --------------------------------------------------------------------------
   */
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

  /**
   * --------------------------------------------------------------------------
   * 3. FT0 Insight Execution Snapshot (authoritative, never inferred)
   * --------------------------------------------------------------------------
   */
  let ft0InsightExecution: {
    attempted: boolean;
    status: 'SUCCESS' | 'EMPTY' | 'DEGRADED' | 'FAILED' | null;
  } = {
    attempted: false,
    status: null,
  };

  if (shopId) {
    const lastExecution = await db('ft0_insight_executions')
      .where({ shop_id: shopId })
      .orderBy('attempted_at', 'desc')
      .first('status');

    if (lastExecution) {
      ft0InsightExecution = {
        attempted: true,
        status: lastExecution.status,
      };
    }
  }

  /**
   * --------------------------------------------------------------------------
   * 4. Entitlement Snapshot (resolved, boolean-only)
   * --------------------------------------------------------------------------
   */
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

  /**
   * --------------------------------------------------------------------------
   * 5. FT0 Derivation (BACKEND-DERIVED INVARIANT)
   * --------------------------------------------------------------------------
   */
  const ft0 = deriveFT0Phase({
    integrations,
    ft0InsightExecution,
  });

  /**
   * --------------------------------------------------------------------------
   * 6. Activation Verdict (CANONICAL DECISION)
   * --------------------------------------------------------------------------
   */
  const verdict = deriveActivationVerdict({
    identity,
    integrations,
    entitlements,
    ft0InsightExecution,
  });

  /**
   * --------------------------------------------------------------------------
   * 7. UI Activation Surface (derived, UI-safe)
   * --------------------------------------------------------------------------
   */
  const activationSurface = buildActivationSurface({
    verdict,
    ft0Phase: ft0.phase as FT0Phase,
  });

  /**
   * --------------------------------------------------------------------------
   * 8. Audit Event (best-effort, non-blocking)
   * --------------------------------------------------------------------------
   */
  if (!entryChannel) {
    throw new Error('[Activation] entryChannel missing at controller boundary');
  }

  const auditEvent = buildActivationAuditEvent({
    userId,
    shopId,
    entryChannel,
    identity,
    integrations,
    entitlements,
    ft0Phase: ft0.phase as FT0Phase,
    verdict,
    activationSurface,
  });

  db('activation_audit_events')
    .insert(auditEvent)
    .catch((err: Error) => {
      console.error(
        JSON.stringify({
          event: 'activation.audit.failed',
          traceId,
          userId,
          shopId,
          error: err?.message,
        })
      );
    });

  /**
   * --------------------------------------------------------------------------
   * 9. Structured Log (diagnostic, traceable)
   * --------------------------------------------------------------------------
   */
  console.info(
    JSON.stringify({
      event: 'activation.verdict.evaluated',
      traceId,
      userId,
      shopId,
      entryChannel,
      ft0Phase: ft0.phase,
      ft0Ready: ft0.ready,
      verdict: verdict.verdict,
    })
  );

  /**
   * --------------------------------------------------------------------------
   * 10. Response (frontend must consume activationSurface)
   * --------------------------------------------------------------------------
   */
  res.json({
    meta: {
      traceId,
      userId,
      shopId,
      entryChannel,
      evaluatedAt: new Date().toISOString(),
    },
    ft0: {
      phase: ft0.phase,
      ready: ft0.ready,
    },
    verdict,            // temporary compatibility
    activationSurface,  // ✅ canonical UI contract
  });
};
