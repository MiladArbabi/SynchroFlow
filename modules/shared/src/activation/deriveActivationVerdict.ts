//modules/shared/src/activation/deriveActivationVerdict.ts
import {
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  ActivationVerdict,
} from './types';
import { deriveFT0Phase } from './deriveFT0Phase';

export function deriveActivationVerdict(input: {
  identity: IdentitySnapshot;
  integrations: IntegrationSnapshot[];
  entitlements: EntitlementSnapshot[];
}): ActivationVerdict {
  const { identity, integrations, entitlements } = input;

  // 1. Authentication
  if (!identity.userId) {
    return {
      verdict: 'BLOCKED',
      reason: 'NOT_AUTHENTICATED',
      explanation: 'User is not authenticated.',
      retryable: true,
    };
  }

  // 2. Shop ownership
  if (!identity.shopId) {
    return {
      verdict: 'BLOCKED',
      reason: 'NO_SHOP',
      explanation: 'No shop is associated with this account.',
      retryable: false,
    };
  }

  // 3. FT0
  const ft0Phase = deriveFT0Phase(integrations);

  if (ft0Phase === 'PRE_INTEGRATION') {
    return {
      verdict: 'BLOCKED',
      reason: 'NO_INTEGRATION',
      explanation: 'No connected platforms found.',
      retryable: true,
    };
  }

  if (ft0Phase === 'SYNCING') {
    return {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial data synchronization is in progress.',
      retryable: false,
    };
  }

  // 4. Entitlements
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

  // 5. Active
  return {
    verdict: 'ACTIVE',
    activatedModules: enabledModules,
  };
}