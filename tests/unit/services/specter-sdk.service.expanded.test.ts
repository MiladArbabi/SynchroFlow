// tests/unit/services/specter-sdk.service.expanded.test.ts
import { SpecterSDKService } from 'api-src/services/specter-sdk.service';

describe('SpecterSDKService - Expanded Coverage', () => {
  describe('Edge Cases', () => {
    test('should handle growth tier with surgical discounts', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'growth',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: true
        }
      });

      expect(sdk.getConfig().moduleTier).toBe('growth');
      expect(sdk.getConfig().features.surgicalDiscounts).toBe(true);
    });

    test('should handle operations tier with all features', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'operations',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: true
        }
      });

      expect(sdk.getConfig().moduleTier).toBe('operations');
      expect(sdk.getConfig().features.surgicalDiscounts).toBe(true);
    });

    test('should generate valid intent scores between 0 and 1', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: false
        }
      });

      const sessionData = sdk.trackSession();
      
      expect(sessionData.intentScore).toBeGreaterThanOrEqual(0);
      expect(sessionData.intentScore).toBeLessThanOrEqual(1);
    });

    test('should increment page views on multiple trackSession calls', () => {
    const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
        sessionTracking: true,
        basicNudges: true,
        exitIntent: true,
        surgicalDiscounts: false
        }
    });

    const session1 = sdk.trackSession(); // pageViews = 2 (initial 1 + increment)
    const session2 = sdk.trackSession(); // pageViews = 3
    
    expect(session2.pageViews).toBe(3); // Fixed: should be 3, not 2
    });
  });

  describe('Nudge Configuration', () => {
    test('should return null nudge config when nudge should not show', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'free',
        features: {
          sessionTracking: true,
          basicNudges: false,
          exitIntent: false,
          surgicalDiscounts: false
        }
      });

      const nudgeConfig = sdk.getNudgeConfiguration('exit_intent');
      
      expect(nudgeConfig).toBeNull();
    });

    test('should return exit intent nudge config for specter tier', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: false
        }
      });

      // Mock high intent
      jest.spyOn(sdk, 'calculateIntentScore').mockReturnValue(0.85);
      sdk.trackSession();

      const nudgeConfig = sdk.getNudgeConfiguration('exit_intent');
      
      expect(nudgeConfig).toHaveProperty('nudgeType', 'exit_intent');
      expect(nudgeConfig).toHaveProperty('trigger', 'mouse_leave');
      expect(nudgeConfig).toHaveProperty('discountPercentage', 10);
    });

    test('should return basic nudge config for scroll depth', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: false
        }
      });

      // Mock high intent
      jest.spyOn(sdk, 'calculateIntentScore').mockReturnValue(0.85);
      sdk.trackSession();

      const nudgeConfig = sdk.getNudgeConfiguration('basic_nudge');
      
      expect(nudgeConfig).toHaveProperty('nudgeType', 'basic_nudge');
      expect(nudgeConfig).toHaveProperty('trigger', 'scroll_depth');
      expect(nudgeConfig).toHaveProperty('threshold', 75);
    });
  });

  describe('Session Data Integrity', () => {
    test('should maintain session ID across multiple trackSession calls', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: false
        }
      });

      const session1 = sdk.trackSession();
      const session2 = sdk.trackSession();
      
      expect(session1.sessionId).toBe(session2.sessionId);
    });

    test('should provide immutable session data', () => {
      const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: {
          sessionTracking: true,
          basicNudges: true,
          exitIntent: true,
          surgicalDiscounts: false
        }
      });

      const sessionData = sdk.getSessionData();
      
      // Attempt to modify should not affect internal state
      (sessionData as any).moduleTier = 'hacked';
      
      const freshData = sdk.getSessionData();
      expect(freshData.moduleTier).toBe('specter');
    });
  });
});