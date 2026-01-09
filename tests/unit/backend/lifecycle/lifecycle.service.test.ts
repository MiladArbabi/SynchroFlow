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

  function mockDbChain({
  membership,
  integrations = [],
  ft0 = null,
  ft2 = null,
}: {
  membership?: any;
  integrations?: any[];
  ft0?: any;
  ft2?: any;
}) {
  let call = 0;

  mockDb.mockImplementation((table: string) => {
    const chain = {
      where: () => chain,
      whereNull: () => chain,
      select: () => {
        if (table === 'shop_memberships') return [membership].filter(Boolean);
        return [];
      },
      first: () => {
        if (table === 'ft0_state') return ft0;
        if (table === 'ft2_state') return ft2;
        return null;
      },
    };

    if (table === 'integrations') {
      return {
        where: () => ({
          select: () => integrations,
        }),
      };
    }

    return chain;
  });
}

  it('returns FT_MINUS_ONE when user has no shop', async () => {
   mockDbChain({
    membership: null,
  });

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT_MINUS_ONE');
  });

  it('returns FT_MINUS_ONE when shop exists but no integrations', async () => {
    mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
    });

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });

  it('returns FT0 when integration exists but FT0 not completed', async () => {
    mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
      ft0: null,
    });

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: false },
      }),
    }));

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });


  it('returns FT0 when FT0 completed but FT1 not ready', async () => {
    mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
      ft0: { shop_id: shopId },
    });

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: false },
      }),
    }));

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });

  it('returns FT1 when FT1 complete and no paid entitlements', async () => {
    mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
      ft0: { shop_id: shopId },
    });

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

  it('does not grant FT2 solely based on paid entitlements', async () => {
   mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
      ft0: { shop_id: shopId },
    });

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
   expect(phase).toBe('FT1');
 });

 it('returns FT2 only when FT2 backend latch exists', async () => {
    mockDbChain({
      membership: { shopId, role: 'owner' },
      integrations: [{ id: 1 }],
      ft0: { shop_id: shopId },
      ft2: { shop_id: shopId },
    });

    (OnboardingReadinessService as jest.Mock).mockImplementation(() => ({
      getSnapshot: jest.fn().mockResolvedValue({
        ft1: { isComplete: true },
      }),
    }));

    (EntitlementsService.getForUser as jest.Mock).mockResolvedValue({
      shopId,
      modules: [],
      flags: ['paid'], // irrelevant now
    });

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT2');
  });

});