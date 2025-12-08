// tests/unit/api/order-nexus.provider.test.ts
// Minimal mock of @lasyncro/shared for this test
jest.mock('@lasyncro/shared', () => ({
  __esModule: true,
  computeModuleAccessState: jest.fn((input: any) => {
    const { moduleId, usageCount } = input;

    if (moduleId === 'order-nexus') {
      if (usageCount < 50) {
        return {
          state: 'free_tier_active',
          remaining: 50 - usageCount
        };
      } else {
        return {
          state: 'free_tier_exhausted',
          remaining: 0
        };
      }
    }

    return {
      state: 'visible',
      remaining: null
    };
  })
}));

// Mock the Knex instance
jest.mock('api-src/db', () => {
  return jest.fn();
});

// Import after mocking
import type { ReadinessSignal } from '@lasyncro/shared';
import { computeModuleAccessState } from '@lasyncro/shared';
import db from 'api-src/db';
import { orderNexusOnboardingSignalProvider } from '../../../apps/backend/src/onboarding/readiness.providers';

type DbMock = jest.Mock;

describe('orderNexusOnboardingSignalProvider', () => {
  const shopId = 1;
  const userId = 123;

  const setupDbMock = (countValue: string | undefined) => {
    const first = jest.fn().mockResolvedValue(
      countValue === undefined ? undefined : { count: countValue }
    );
    const count = jest.fn().mockReturnValue({ first });
    const where = jest.fn().mockReturnValue({ count });

    (db as unknown as DbMock).mockReturnValue({
      where,
      count,
      first,
    });

    return { where, count, first };
  };

  const extractSignals = (signals: ReadinessSignal[]) => {
    const map = new Map<string, ReadinessSignal>();
    signals.forEach((s) => map.set(s.name, s));
    return map;
  };

  const findSignal = (signals: ReadinessSignal[], name: string) => 
    signals.find((s) => s.name === name);

  beforeEach(() => {
    (db as unknown as DbMock).mockReset();
    jest.clearAllMocks();
    
    // Reset the mock implementation
    (computeModuleAccessState as jest.Mock).mockImplementation((input) => {
      const { moduleId, usageCount } = input;
      
      if (moduleId === 'order-nexus') {
        if (usageCount < 50) {
          return {
            state: 'free_tier_active',
            remaining: 50 - usageCount
          };
        } else {
          return {
            state: 'free_tier_exhausted',
            remaining: 0
          };
        }
      }
      
      return {
        state: 'visible',
        remaining: null
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Basic functionality tests
  it('returns 0 ordersIngested and profitabilityActive=false when there are no canonical orders', async () => {
    const { where } = setupDbMock('0');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });
    const signalMap = extractSignals(signals);

    expect(where).toHaveBeenCalledWith({ shop_id: shopId });
    expect(signalMap.get('orderNexus.ordersIngested')?.value).toBe(0);
    expect(signalMap.get('orderNexus.profitabilityActive')?.value).toBe(false);
    
    // Verify computeModuleAccessState was called with correct parameters
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 0,
      entitlementAccess: 'free-tier'
    });
  });

  it('sets profitabilityActive=true when there is at least one canonical order', async () => {
    setupDbMock('3');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('orderNexus.ordersIngested')?.value).toBe(3);
    expect(signalMap.get('orderNexus.profitabilityActive')?.value).toBe(true);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 3,
      entitlementAccess: 'free-tier'
    });
  });

  it('handles undefined count row gracefully', async () => {
    setupDbMock(undefined);

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('orderNexus.ordersIngested')?.value).toBe(0);
    expect(signalMap.get('orderNexus.profitabilityActive')?.value).toBe(false);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 0,
      entitlementAccess: 'free-tier'
    });
  });

  it('emits free-tier state and remaining signals under threshold', async () => {
    setupDbMock('10');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });

    const freeTierState = findSignal(signals, 'order-nexus.freeTierState');
    const freeTierRemaining = findSignal(signals, 'order-nexus.freeTierRemaining');

    expect(freeTierState?.value).toBe('free_tier_active');
    expect(freeTierRemaining?.value).toBe(40);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 10,
      entitlementAccess: 'free-tier'
    });
  });

  it('emits free-tier exhausted when usage reaches the limit', async () => {
    setupDbMock('50');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });

    const freeTierState = findSignal(signals, 'order-nexus.freeTierState');
    const freeTierRemaining = findSignal(signals, 'order-nexus.freeTierRemaining');

    expect(freeTierState?.value).toBe('free_tier_exhausted');
    expect(freeTierRemaining?.value).toBe(0);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 50,
      entitlementAccess: 'free-tier'
    });
  });

  // Additional test cases
  it('emits free-tier exhausted when usage exceeds the limit', async () => {
    setupDbMock('75');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });

    const freeTierState = findSignal(signals, 'order-nexus.freeTierState');
    const freeTierRemaining = findSignal(signals, 'order-nexus.freeTierRemaining');

    expect(freeTierState?.value).toBe('free_tier_exhausted');
    expect(freeTierRemaining?.value).toBe(0);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 75,
      entitlementAccess: 'free-tier'
    });
  });

  it('handles edge case with exactly one order below limit', async () => {
    setupDbMock('1');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('orderNexus.ordersIngested')?.value).toBe(1);
    expect(signalMap.get('orderNexus.profitabilityActive')?.value).toBe(true);
    
    const freeTierState = findSignal(signals, 'order-nexus.freeTierState');
    const freeTierRemaining = findSignal(signals, 'order-nexus.freeTierRemaining');

    expect(freeTierState?.value).toBe('free_tier_active');
    expect(freeTierRemaining?.value).toBe(49);
    
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: 1,
      entitlementAccess: 'free-tier'
    });
  });

  describe('Signal completeness', () => {
    it('returns all expected signal names', async () => {
      setupDbMock('25');

      const signals = await orderNexusOnboardingSignalProvider.getSignals({
        shopId,
        userId,
      });
      const signalNames = signals.map(s => s.name);

      expect(signalNames).toContain('orderNexus.profitabilityActive');
      expect(signalNames).toContain('orderNexus.ordersIngested');
      expect(signalNames).toContain('order-nexus.freeTierState');
      expect(signalNames).toContain('order-nexus.freeTierRemaining');
      expect(signalNames).toHaveLength(4);
    });

    it('maintains correct signal types', async () => {
      setupDbMock('25');

      const signals = await orderNexusOnboardingSignalProvider.getSignals({
        shopId,
        userId,
      });
      const signalMap = extractSignals(signals);

      expect(typeof signalMap.get('orderNexus.profitabilityActive')?.value).toBe('boolean');
      expect(typeof signalMap.get('orderNexus.ordersIngested')?.value).toBe('number');
      expect(typeof signalMap.get('order-nexus.freeTierState')?.value).toBe('string');
      expect(typeof signalMap.get('order-nexus.freeTierRemaining')?.value).toBe('number');
    });
  });

  describe('Edge cases', () => {
    it('handles zero userId scenario (userId not provided)', async () => {
      setupDbMock('30');

      const signals = await orderNexusOnboardingSignalProvider.getSignals({
        shopId,
        // No userId provided
      });

      expect(signals).toBeDefined();
      expect(signals.length).toBe(4);
      
      const ordersIngested = findSignal(signals, 'orderNexus.ordersIngested');
      expect(ordersIngested?.value).toBe(30);
    });

    it('uses correct database table and column names', async () => {
      const { where } = setupDbMock('10');

      await orderNexusOnboardingSignalProvider.getSignals({
        shopId,
        userId,
      });

      expect(db).toHaveBeenCalledWith('canonical_orders');
      expect(where).toHaveBeenCalledWith({ shop_id: shopId });
    });
  });

  describe('Free tier state transitions', () => {
    const testCases = [
      { orders: 0, expectedState: 'free_tier_active', expectedRemaining: 50, description: 'zero orders' },
      { orders: 25, expectedState: 'free_tier_active', expectedRemaining: 25, description: 'half capacity' },
      { orders: 49, expectedState: 'free_tier_active', expectedRemaining: 1, description: 'one below limit' },
      { orders: 50, expectedState: 'free_tier_exhausted', expectedRemaining: 0, description: 'at limit' },
      { orders: 51, expectedState: 'free_tier_exhausted', expectedRemaining: 0, description: 'one above limit' },
    ];

    testCases.forEach(({ orders, expectedState, expectedRemaining, description }) => {
      it(`transitions correctly with ${description}`, async () => {
        setupDbMock(orders.toString());

        const signals = await orderNexusOnboardingSignalProvider.getSignals({
          shopId,
          userId,
        });

        const freeTierState = findSignal(signals, 'order-nexus.freeTierState');
        const freeTierRemaining = findSignal(signals, 'order-nexus.freeTierRemaining');

        expect(freeTierState?.value).toBe(expectedState);
        expect(freeTierRemaining?.value).toBe(expectedRemaining);
      });
    });
  });

  // Test database error handling
  it('handles database errors gracefully', async () => {
    // Mock a database error
    const error = new Error('Database connection failed');
    const first = jest.fn().mockRejectedValue(error);
    const count = jest.fn().mockReturnValue({ first });
    const where = jest.fn().mockReturnValue({ count });
    
    (db as unknown as DbMock).mockReturnValue({
      where,
      count,
      first,
    });

    await expect(orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    })).rejects.toThrow('Database connection failed');
  });

  // Test with negative orders (edge case from database)
  it('handles negative orders count from database', async () => {
    setupDbMock('-5');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
      userId,
    });

    const ordersIngested = findSignal(signals, 'orderNexus.ordersIngested');
    // The provider just converts string to number, so it will be -5
    expect(ordersIngested?.value).toBe(-5);
    
    // computeModuleAccessState should still be called with -5
    expect(computeModuleAccessState).toHaveBeenCalledWith({
      moduleId: 'order-nexus',
      usageCount: -5,
      entitlementAccess: 'free-tier'
    });
  });
});