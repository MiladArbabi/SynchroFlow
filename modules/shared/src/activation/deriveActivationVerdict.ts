//modules/shared/src/activation/deriveActivationVerdict.ts
import {
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
  ActivationVerdict
} from './types.js';

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

  // 3. Integration presence (FT0 phase handled elsewhere)
  if (integrations.length === 0) {
    return {
      verdict: 'BLOCKED',
      reason: 'NO_INTEGRATION',
      explanation: 'No connected platforms found.',
      retryable: true,
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