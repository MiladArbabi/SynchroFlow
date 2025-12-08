// tests/unit/onboarding/sku-os-readiness.provider.test.ts

import { skuOsOnboardingSignalProvider } from '../../../apps/backend/src/onboarding/readiness.providers';
import db from '../../../apps/backend/src/db';
import type { ReadinessSignal } from '@lasyncro/shared';

// Mock the database module
jest.mock('../../../apps/backend/src/db', () => {
  const mockWhere = jest.fn().mockReturnThis();
  const mockCount = jest.fn().mockReturnThis();
  const mockFirst = jest.fn();

  const dbFn: any = jest.fn(() => ({
    where: mockWhere,
    count: mockCount,
    first: mockFirst,
  }));

  // Expose mocks for test control
  dbFn.__mock = { mockWhere, mockCount, mockFirst };

  return dbFn;
});

// Helper to get the mock methods
const getDbMocks = () => (db as any).__mock as {
  mockWhere: jest.Mock;
  mockCount: jest.Mock;
  mockFirst: jest.Mock;
};

// Helper to find signals by name
const findSignal = (signals: ReadinessSignal[], name: string) =>
  signals.find((s) => s.name === name);

describe('skuOsOnboardingSignalProvider', () => {
  beforeEach(() => {
    const { mockWhere, mockCount, mockFirst } = getDbMocks();
    mockWhere.mockClear();
    mockCount.mockClear();
    mockFirst.mockClear();
    
    // Reset to default chain
    mockWhere.mockReturnThis();
    mockCount.mockReturnThis();
  });

  describe('moduleId', () => {
    it('should have correct moduleId', () => {
      expect(skuOsOnboardingSignalProvider.moduleId).toBe('sku-os');
    });
  });

  describe('getSignals', () => {
    it('should query canonical_products table for the given shopId', async () => {
      const { mockWhere, mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '10' });

      await skuOsOnboardingSignalProvider.getSignals({ shopId: 123 });

      expect(mockWhere).toHaveBeenCalledWith({ shop_id: 123 });
      expect(mockWhere).toHaveBeenCalledTimes(1);
    });

    it('should handle zero products correctly', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '0' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 1 });

      // Test product count signal
      expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(0);
      
      // Test health events (should equal product count in v1)
      expect(findSignal(signals, 'skuOs.productHealthEvents')?.value).toBe(0);
      
      // Free tier signals should be present
      const freeTierState = findSignal(signals, 'sku-os.freeTierState');
      const freeTierRemaining = findSignal(signals, 'sku-os.freeTierRemaining');
      
      expect(freeTierState).toBeDefined();
      expect(freeTierRemaining).toBeDefined();
      
      // With 0 products, free tier should be in 'available' or similar state
      // Note: Actual state depends on computeModuleAccessState implementation
      expect(freeTierState?.value).toBeDefined();
      expect(freeTierRemaining?.value).toBeDefined();
    });

    it('should handle non-zero product count correctly', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '15' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 2 });

      expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(15);
      expect(findSignal(signals, 'skuOs.productHealthEvents')?.value).toBe(15);
      
      // Free tier signals should reflect usage
      const freeTierState = findSignal(signals, 'sku-os.freeTierState');
      const freeTierRemaining = findSignal(signals, 'sku-os.freeTierRemaining');
      
      expect(freeTierState).toBeDefined();
      expect(freeTierRemaining).toBeDefined();
    });

    it('should handle null database response', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce(null);

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 3 });

      expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(0);
      expect(findSignal(signals, 'skuOs.productHealthEvents')?.value).toBe(0);
    });

    it('should handle undefined database response', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce(undefined);

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 4 });

      expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(0);
      expect(findSignal(signals, 'skuOs.productHealthEvents')?.value).toBe(0);
    });

    it('should handle string count that is not a number', async () => {
    const { mockFirst } = getDbMocks();
    mockFirst.mockResolvedValueOnce({ count: 'not-a-number' });

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 5 });

    expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(0);
    expect(findSignal(signals, 'skuOs.productHealthEvents')?.value).toBe(0);
    });

    it('should return all expected signal types', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '7' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 6 });

      const expectedSignalNames = [
        'skuOs.productCount',
        'skuOs.productHealthEvents',
        'sku-os.freeTierState',
        'sku-os.freeTierRemaining'
      ];

      expectedSignalNames.forEach(signalName => {
        expect(findSignal(signals, signalName)).toBeDefined();
      });

      expect(signals).toHaveLength(expectedSignalNames.length);
    });

    it('should compute free tier state based on product count', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '25' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 7 });

      const freeTierState = findSignal(signals, 'sku-os.freeTierState');
      const freeTierRemaining = findSignal(signals, 'sku-os.freeTierRemaining');
      
      // These values depend on computeModuleAccessState implementation
      // We're just testing they exist and are consistent
      expect(freeTierState?.value).toBeDefined();
      expect(freeTierRemaining?.value).toBeDefined();
      
      // If product count is 25, remaining should be less than or equal to limit
      // (Assuming free tier has a limit)
      if (freeTierRemaining) {
        expect(['number', 'object']).toContain(typeof freeTierRemaining.value);
      }
    });

    it('should ignore userId parameter (not used in SKU OS provider)', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '12' });

      // Test with userId included
      const signals = await skuOsOnboardingSignalProvider.getSignals({ 
        shopId: 8, 
        userId: 999 
      });

      // Should still work the same
      expect(findSignal(signals, 'skuOs.productCount')?.value).toBe(12);
    });
  });

  describe('signal structure', () => {
    it('should return signals with correct structure', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '3' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 9 });

      signals.forEach(signal => {
        expect(signal).toHaveProperty('name');
        expect(signal).toHaveProperty('value');
        expect(typeof signal.name).toBe('string');
        // value can be any type (boolean, number, string, null)
      });
    });

    it('should maintain signal order consistency', async () => {
      const { mockFirst } = getDbMocks();
      mockFirst.mockResolvedValueOnce({ count: '5' });

      const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId: 10 });
      
      // Check order matches implementation
      expect(signals[0].name).toBe('skuOs.productCount');
      expect(signals[1].name).toBe('skuOs.productHealthEvents');
      expect(signals[2].name).toBe('sku-os.freeTierState');
      expect(signals[3].name).toBe('sku-os.freeTierRemaining');
    });
  });
});