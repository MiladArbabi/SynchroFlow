//tests/unit/backend/lifecycle/lifecycle.resolver.test.ts
import { resolveLifecyclePhase } from 'api-src/services/lifecycle.resolver';

describe('resolveLifecyclePhase (pure)', () => {
  it('returns FT_MINUS_ONE when user has no shop', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: false,
        hasIntegration: false,
        ft0Completed: false,
        ft1Complete: false,
        hasPaidEntitlements: false,
      })
    ).toBe('FT_MINUS_ONE');
  });

  it('returns FT_MINUS_ONE when shop exists but no integration', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: true,
        hasIntegration: false,
        ft0Completed: false,
        ft1Complete: false,
        hasPaidEntitlements: false,
      })
    ).toBe('FT_MINUS_ONE');
  });

  it('returns FT0 when integration exists but FT0 not completed', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: true,
        hasIntegration: true,
        ft0Completed: false,
        ft1Complete: false,
        hasPaidEntitlements: false,
      })
    ).toBe('FT0');
  });

  it('returns FT0 when FT0 completed but FT1 not complete', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: true,
        hasIntegration: true,
        ft0Completed: true,
        ft1Complete: false,
        hasPaidEntitlements: false,
      })
    ).toBe('FT0');
  });

  it('returns FT1 when FT1 complete and no paid entitlements', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: true,
        hasIntegration: true,
        ft0Completed: true,
        ft1Complete: true,
        hasPaidEntitlements: false,
      })
    ).toBe('FT1');
  });

  it('returns FT2 when FT1 complete and paid entitlements exist', () => {
    expect(
      resolveLifecyclePhase({
        hasShop: true,
        hasIntegration: true,
        ft0Completed: true,
        ft1Complete: true,
        hasPaidEntitlements: true,
      })
    ).toBe('FT2');
  });
});
