// tests/unit/backend/activation/deriveActivationSurfaceState.test.ts

import { deriveActivationSurfaceState } from '@lasyncro/shared/activation';
import { ActivationVerdict } from '@lasyncro/shared/activation';

describe('deriveActivationSurfaceState', () => {
  test('BLOCKED_AUTH → surface BLOCKED_AUTH', () => {
    const verdict: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NOT_AUTHENTICATED',
      explanation: 'User is not authenticated.',
      retryable: true,
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'PRE_INTEGRATION',
    });

    expect(surface.state).toBe('BLOCKED_AUTH');
    expect(surface.primaryAction?.action).toBe('LOGIN');
  });

  test('BLOCKED_SHOP → surface BLOCKED_SHOP', () => {
    const verdict: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NO_SHOP',
      explanation: 'No shop is associated with this account.',
      retryable: false,
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'PRE_INTEGRATION',
    });

    expect(surface.state).toBe('BLOCKED_SHOP');
    expect(surface.primaryAction?.action).toBe('CONNECT_SHOP');
  });

  test('NO_INTEGRATION → surface CONNECT_INTEGRATION', () => {
    const verdict: ActivationVerdict = {
      verdict: 'BLOCKED',
      reason: 'NO_INTEGRATION',
      explanation: 'No connected platforms found.',
      retryable: true,
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'PRE_INTEGRATION',
    });

    expect(surface.state).toBe('CONNECT_INTEGRATION');
  });

  test('FT0_SYNCING → surface SYNC_IN_PROGRESS', () => {
    const verdict: ActivationVerdict = {
      verdict: 'PENDING',
      reason: 'FT0_SYNCING',
      explanation: 'Initial data synchronization is in progress.',
      retryable: false,
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'SYNCING',
    });

    expect(surface.state).toBe('SYNC_IN_PROGRESS');
    expect(surface.progress?.phase).toBe('FT0');
  });

  test('ENTITLEMENT_PENDING → surface READY_PENDING_MODULES', () => {
    const verdict: ActivationVerdict = {
      verdict: 'PENDING',
      reason: 'ENTITLEMENT_PENDING',
      explanation: 'Required entitlements are not yet active.',
      retryable: false,
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'READY',
    });

    expect(surface.state).toBe('READY_PENDING_MODULES');
  });

  test('ACTIVE → surface ACTIVE', () => {
    const verdict: ActivationVerdict = {
      verdict: 'ACTIVE',
      activatedModules: ['order-nexus'],
    };

    const surface = deriveActivationSurfaceState({
      verdict,
      ft0Phase: 'READY',
    });

    expect(surface.state).toBe('ACTIVE');
    expect(surface.primaryAction?.action).toBe('GO_TO_DASHBOARD');
  });
});