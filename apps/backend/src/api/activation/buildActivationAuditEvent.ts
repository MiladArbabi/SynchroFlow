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
} from '@lasyncro/shared/activation';
import { ACTIVATION_DERIVATION_VERSION } from '@lasyncro/shared/activation';

export function buildActivationAuditEvent(input: {
  derivationVersion: string;

  userId: number | null;
  shopId: number | null;
  entryChannel: 'SHOPIFY_APP' | 'WEB' | null;

  identity: IdentitySnapshot;
  integrations: IntegrationSnapshot[];
  entitlements: EntitlementSnapshot[];
  ft0Phase: FT0Phase;
  verdict: ActivationVerdict;
}) {
  const evaluatedAt = new Date().toISOString();

  const payload = {
    schema: 'activation_audit.v1',
    meta: {
      derivationVersion: input.derivationVersion,
      evaluatedAt,
    },
    identity: input.identity,
    integrations: input.integrations,
    entitlements: input.entitlements,
    ft0Phase: input.ft0Phase,
    verdict: input.verdict,
  };

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

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
