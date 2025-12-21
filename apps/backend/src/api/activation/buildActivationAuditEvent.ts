// apps/backend/src/api/activation/buildActivationAuditEvent.ts

/**
 * Activation Audit Event Builder
 * ------------------------------
 * Pure, deterministic builder for activation audit records.
 *
 * Responsibilities:
 * - Attach derivation metadata
 * - Normalize verdict + reason
 * - Produce immutable, hashable payload
 *
 * IMPORTANT:
 * - This function MUST stay pure
 * - Any change here requires a new derivationVersion
 */

import crypto from 'crypto';
import {
  ActivationVerdict,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  FT0Phase,
  ACTIVATION_DERIVATION_VERSION
} from '@lasyncro/shared/activation';

export function buildActivationAuditEvent(input: {
  userId: number | null;
  shopId: number | null;
  entryChannel: 'SHOPIFY_APP' | 'WEB';

  identity: IdentitySnapshot;
  integrations: IntegrationSnapshot[];
  entitlements: EntitlementSnapshot[];
  ft0Phase: FT0Phase;
  verdict: ActivationVerdict;
  activationSurface: unknown;
}) {
  const evaluatedAt = new Date().toISOString();

  const payload = {
    schema: 'activation_audit.v1',
    meta: {
      derivationVersion: ACTIVATION_DERIVATION_VERSION,
      evaluatedAt,
    },
    identity: input.identity,
    integrations: input.integrations,
    entitlements: input.entitlements,
    ft0Phase: input.ft0Phase,
    verdict: input.verdict,
    activationSurface: input.activationSurface,
  };

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  // ─────────────────────────────────────────────
  // Invariant enforcement (DO NOT REMOVE)
  // ─────────────────────────────────────────────

  if (!ACTIVATION_DERIVATION_VERSION) {
    throw new Error('[ActivationAudit] ACTIVATION_DERIVATION_VERSION not defined');
  }

  if (payload.meta.derivationVersion !== ACTIVATION_DERIVATION_VERSION) {
    throw new Error(
      '[ActivationAudit] derivationVersion mismatch with builder constant'
    );
  }

  if (!payloadHash) {
    throw new Error('[ActivationAudit] Failed to compute payload_hash');
  }

  if (!input.entryChannel) {
    throw new Error('[ActivationAudit] entryChannel must be set');
  }

  if (!input.verdict?.verdict) {
    throw new Error('[ActivationAudit] verdict.verdict missing');
  }

  return {
    event_id: crypto.randomUUID(),
    user_id: input.userId,
    shop_id: input.shopId,
    entry_channel: input.entryChannel,
    verdict: input.verdict.verdict,
    reason:
      input.verdict.verdict === 'BLOCKED' || input.verdict.verdict === 'PENDING'
        ? input.verdict.reason
        : null,

    derivation_version: ACTIVATION_DERIVATION_VERSION,

    payload,
    payload_hash: payloadHash,
    evaluated_at: evaluatedAt,
  };
}