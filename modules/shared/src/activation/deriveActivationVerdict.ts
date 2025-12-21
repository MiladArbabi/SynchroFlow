// modules/shared/src/activation/deriveActivationVerdict.ts

import {
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  ActivationVerdict,
} from './types';
import { deriveFT0Phase } from './deriveFT0Phase';

/**
 * deriveActivationVerdict
 * -----------------------
 * Canonical backend-owned activation decision function.
 *
 * Responsibilities:
 * - Enforce identity + shop ownership
 * - Enforce FT0 readiness as a hard invariant (never inferred)
 * - Gate module activation behind entitlements
 *
 * Invariants:
 * - FT0 readiness is derived, not guessed
 * - ACTIVE is impossible unless FT0.ready === true
 * - UI must never re-evaluate these rules
 */
export function deriveActivationVerdict(input: {
  identity: IdentitySnapshot;
  integrations: IntegrationSnapshot[];
  entitlements: EntitlementSnapshot[];
  ft0InsightExecution: {
    attempted: boolean;
    status: 'SUCCESS' | 'EMPTY' | 'DEGRADED' | 'FAILED' | null;
  };
}): ActivationVerdict {
  const { identity, integrations, entitlements, ft0InsightExecution } = input;

  /**
   * 1. Authentication gate
   */
  if (!identity.userId) {
    return {
      verdict: 'BLOCKED',
      reason: 'NOT_AUTHENTICATED',
      explanation: 'User is not authenticated.',
      retryable: true,
    };
  }

  /**
   * 2. Shop ownership gate
   */
  if (!identity.shopId) {
    return {
      verdict: 'BLOCKED',
      reason: 'NO_SHOP',
      explanation: 'No shop is associated with this account.',
      retryable: false,
    };
  }

  /**
   * 3. FT0 derivation (backend-derived invariant)
   *
   * This is the single source of truth for:
   * - integration completeness
   * - initial insight execution
   * - readiness to unlock modules
   */
  const { phase, ready } = deriveFT0Phase({
    integrations,
    ft0InsightExecution,
  });

  if (phase === 'PRE_INTEGRATION') {
    return {
      verdict: 'BLOCKED',
      reason: 'NO_INTEGRATION',
      explanation: 'No connected platforms found.',
      retryable: true,
    };
  }

  if (phase === 'SYNCING') {
    return {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial data synchronization is in progress.',
      retryable: false,
    };
  }

  /**
   * FT0 resolved but NOT ready
   * (e.g. insight not attempted or failed)
   */
  if (!ready) {
    return {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'FT0 initialization is incomplete.',
      retryable: false,
    };
  }

  /**
   * 4. Entitlement gate
   */
  const enabledModules = entitlements
    .filter(e => e.enabled)
    .map(e => e.moduleKey);

  if (enabledModules.length === 0) {
    return {
      verdict: 'PENDING',
      reason: 'ENTITLEMENT_PENDING',
      explanation: 'Required entitlements are not yet active.',
      retryable: false,
    };
  }

  /**
   * 5. ACTIVE — all invariants satisfied
   */
  return {
    verdict: 'ACTIVE',
    activatedModules: enabledModules,
  };
}
