// tests/unit/backend/activation/deriveActivationVerdict.ft0.test.ts

import { deriveActivationVerdict } from '@lasyncro/shared/activation';
import {
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
} from '@lasyncro/shared/activation';

describe('deriveActivationVerdict — FT0 readiness gating', () => {
  const identity: IdentitySnapshot = {
    userId: 1,
    shopId: 10,
    entryChannel: 'SHOPIFY_APP',
  };

  const completedIntegration: IntegrationSnapshot = {
    platform: 'shopify',
    syncStatus: 'COMPLETED',
  };

  it('returns PENDING when FT0 is RESOLVED but not ready', () => {
    const result = deriveActivationVerdict({
      identity,
      integrations: [completedIntegration],
      entitlements: [{ moduleKey: 'order-nexus', enabled: true }],
      ft0InsightExecution: {
        attempted: false,
        status: null,
      },
    });

    expect(result).toEqual({
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: expect.any(String),
      retryable: false,
    });
  });

  it('returns PENDING when FT0 is ready but no entitlements are enabled', () => {
    const result = deriveActivationVerdict({
      identity,
      integrations: [completedIntegration],
      entitlements: [],
      ft0InsightExecution: {
        attempted: true,
        status: 'SUCCESS',
      },
    });

    expect(result).toEqual({
      verdict: 'PENDING',
      reason: 'ENTITLEMENT_PENDING',
      explanation: expect.any(String),
      retryable: false,
    });
  });

  it('returns ACTIVE when FT0 is ready and entitlements are enabled', () => {
    const entitlements: EntitlementSnapshot[] = [
      { moduleKey: 'order-nexus', enabled: true },
      { moduleKey: 'insight-core', enabled: true },
    ];

    const result = deriveActivationVerdict({
      identity,
      integrations: [completedIntegration],
      entitlements,
      ft0InsightExecution: {
        attempted: true,
        status: 'EMPTY',
      },
    });

    expect(result).toEqual({
      verdict: 'ACTIVE',
      activatedModules: ['order-nexus', 'insight-core'],
    });
  });
});