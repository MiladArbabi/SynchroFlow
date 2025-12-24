// tests/unit/backend/lifecycle/lifecycle.service.test.ts
import { LifecycleService } from 'api-src/services/lifecycle.service';
import db from 'api-src/db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { EntitlementsService } from 'api-src/services/entitlements.service';

// ---- Mocks ----
jest.mock('api-src/db', () => jest.fn());
jest.mock('api-src/onboarding/readiness.service');
jest.mock('api-src/services/entitlements.service');
jest.mock('api-src/services/lifecycle-transition.service', () => ({
  LifecycleTransitionService: {
    auditIfTransitioned: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockDb = db as unknown as jest.Mock;

describe('LifecycleService.resolveForUser (unit)', () => {
  const userId = 1;
  const shopId = 10;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockDbChain(responses: any[]) {
    let call = 0;
    mockDb.mockImplementation(() => ({
      where: () => ({
        first: () => responses[call++],
        select: () => responses[call++],
      }),
    }));
  }

  it('returns FT_MINUS_ONE when user has no shop', async () => {
    mockDbChain([null]);

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT_MINUS_ONE');
  });

  it('returns FT_MINUS_ONE when shop exists but no integrations', async () => {
    mockDbChain([
      { id: userId, shop_id: shopId }, // user
      [],                              // integrations
    ]);

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT_MINUS_ONE');
  });

  it('returns FT0 when integration exists but FT0 not completed', async () => {
    mockDbChain([
      { id: userId, shop_id: shopId }, // user
      [{ id: 1 }],                     // integrations
      null,                            // ft0_state
    ]);

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });

  it('returns FT0 when FT0 completed but FT1 not ready', async () => {
    mockDbChain([
      { id: userId, shop_id: shopId }, // user
      [{ id: 1 }],                     // integrations
      { shop_id: shopId },             // ft0_state
    ]);

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: false },
      }),
    }));

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });

  it('returns FT1 when FT1 complete and no paid entitlements', async () => {
    mockDbChain([
      { id: userId, shop_id: shopId }, // user
      [{ id: 1 }],                     // integrations
      { shop_id: shopId },             // ft0_state
    ]);

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: true },
      }),
    }));

    (EntitlementsService.getForUser as jest.Mock).mockResolvedValue({
      shopId,
      modules: [],
      flags: [],
    });

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT1');
  });

  it('returns FT2 when FT1 complete and paid entitlements exist', async () => {
    mockDbChain([
      { id: userId, shop_id: shopId }, // user
      [{ id: 1 }],                     // integrations
      { shop_id: shopId },             // ft0_state
    ]);

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: true },
      }),
    }));

    (EntitlementsService.getForUser as jest.Mock).mockResolvedValue({
      shopId,
      modules: [],
      flags: ['paid'],
    });

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT2');
  });
});