//tests/unit/backend/activation/deriveActivationVerdict.test.ts
import { deriveActivationVerdict } from '@lasyncro/shared/activation/deriveActivationVerdict';

describe('deriveActivationVerdict', () => {
  const baseIdentity = {
    userId: 1,
    shopId: 10,
    entryChannel: 'WEB' as const,
  };

  it('blocks when user is not authenticated', () => {
    const result = deriveActivationVerdict({
      identity: { ...baseIdentity, userId: null },
      integrations: [],
      entitlements: [],
    });

    expect(result).toEqual({
      verdict: 'BLOCKED',
      reason: 'NOT_AUTHENTICATED',
      explanation: 'User is not authenticated.',
      retryable: true,
    });
  });

  it('blocks when user has no shop', () => {
    const result = deriveActivationVerdict({
      identity: { ...baseIdentity, shopId: null },
      integrations: [],
      entitlements: [],
    });

    expect(result).toEqual({
      verdict: 'BLOCKED',
      reason: 'NO_SHOP',
      explanation: 'No shop is associated with this account.',
      retryable: false,
    });
  });

  it('blocks when no integrations exist', () => {
    const result = deriveActivationVerdict({
      identity: baseIdentity,
      integrations: [],
      entitlements: [],
    });

    expect(result).toEqual({
      verdict: 'BLOCKED',
      reason: 'NO_INTEGRATION',
      explanation: 'No connected platforms found.',
      retryable: true,
    });
  });

  it('returns PENDING when integrations exist but syncing is in progress', () => {
    const result = deriveActivationVerdict({
      identity: baseIdentity,
      integrations: [
        { platform: 'shopify', syncStatus: 'IN_PROGRESS' },
      ],
      entitlements: [],
    });

    expect(result).toEqual({
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial data synchronization is in progress.',
      retryable: false,
    });
  });

  it('returns PENDING when integration is completed but no entitlements are enabled', () => {
    const result = deriveActivationVerdict({
      identity: baseIdentity,
      integrations: [
        { platform: 'shopify', syncStatus: 'COMPLETED' as const},
      ],
      entitlements: [
        { moduleKey: 'dashboard', enabled: false },
      ],
    });

    expect(result).toEqual({
      verdict: 'PENDING',
      reason: 'ENTITLEMENT_PENDING',
      explanation: 'Required entitlements are not yet active.',
      retryable: false,
    });
  });

  it('returns ACTIVE when at least one entitlement is enabled and integration is completed', () => {
    const result = deriveActivationVerdict({
      identity: baseIdentity,
      integrations: [
        { platform: 'shopify', syncStatus: 'COMPLETED' as const },
      ],
      entitlements: [
        { moduleKey: 'dashboard', enabled: true },
        { moduleKey: 'specter', enabled: false },
      ],
    });

    expect(result).toEqual({
      verdict: 'ACTIVE',
      activatedModules: ['dashboard'],
    });
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      identity: baseIdentity,
      integrations: [
        { platform: 'shopify', syncStatus: 'COMPLETED' as const },
      ],
      entitlements: [
        { moduleKey: 'dashboard', enabled: true },
      ],
    };

    const first = deriveActivationVerdict(input);
    const second = deriveActivationVerdict(input);

    expect(first).toEqual(second);
  });
});
