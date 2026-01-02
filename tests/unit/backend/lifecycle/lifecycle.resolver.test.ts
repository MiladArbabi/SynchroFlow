// tests/unit/backend/lifecycle/lifecycle.resolver.test.ts
import { resolveLifecyclePhase } from 'api-src/services/lifecycle.resolver';

describe('resolveLifecyclePhase (pure)', () => {
  it('returns FT_MINUS_ONE when user has no shop', () => {
    expect(resolveLifecyclePhase({
      hasShop: false,
      hasIntegration: false,
      ft0Completed: false,
      ft1Complete: false,
      hasPaidEntitlements: false,
    })).toBe('FT_MINUS_ONE');
  });

  it('returns FT0 when FT0 or FT1 incomplete', () => {
    expect(resolveLifecyclePhase({
      hasShop: true,
      hasIntegration: true,
      ft0Completed: true,
      ft1Complete: false,
      hasPaidEntitlements: false,
    })).toBe('FT0');
  });

  it('returns FT1 when FT1 complete and no FT2 latch', () => {
    expect(resolveLifecyclePhase({
      hasShop: true,
      hasIntegration: true,
      ft0Completed: true,
      ft1Complete: true,
      hasPaidEntitlements: true,
    } as any)).toBe('FT1');
  });

  it('returns FT2 ONLY when explicit FT2 latch exists', () => {
    expect(resolveLifecyclePhase({
      hasShop: true,
      hasIntegration: true,
      ft0Completed: true,
      ft1Complete: true,
      hasPaidEntitlements: false,
      ft2Completed: true,
    } as any)).toBe('FT2');
  });
});
