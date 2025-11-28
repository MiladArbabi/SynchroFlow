// tests/unit/services/specter-sdk.service.test.ts
import { SpecterSDKService } from 'api-src/services/specter-sdk.service';

describe('SpecterSDKService', () => {
  describe('Module Configuration', () => {
    test('should initialize with free tier configuration', () => {
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
      
      expect(sdk.getConfig().moduleTier).toBe('free');
      expect(sdk.getConfig().features.basicNudges).toBe(false);
    });

    test('should initialize with specter tier configuration', () => {
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
      
      expect(sdk.getConfig().moduleTier).toBe('specter');
      expect(sdk.getConfig().features.basicNudges).toBe(true);
    });
  });

    describe('Session Tracking', () => {
    test('should track basic session in free tier', () => {
        const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'free',
        features: { sessionTracking: true, basicNudges: false, exitIntent: false, surgicalDiscounts: false }
        });

        const sessionData = sdk.trackSession();
        
        expect(sessionData).toHaveProperty('sessionId');
        expect(sessionData).toHaveProperty('timestamp');
        expect(sessionData.moduleTier).toBe('free');
        expect(sessionData.intentScore).toBeUndefined(); // Free tier doesn't get intent scoring
    });

    test('should enhance session tracking in specter tier', () => {
        const sdk = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'specter',
        features: { sessionTracking: true, basicNudges: true, exitIntent: true, surgicalDiscounts: false }
        });

        const sessionData = sdk.trackSession();
        
        expect(sessionData).toHaveProperty('sessionId');
        expect(sessionData).toHaveProperty('intentScore');
        expect(sessionData.moduleTier).toBe('specter');
        expect(sessionData.intentScore).toBeGreaterThanOrEqual(0);
        expect(sessionData.intentScore).toBeLessThanOrEqual(1);
    });

    test('should generate unique session IDs', () => {
        const sdk1 = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'free',
        features: { sessionTracking: true, basicNudges: false, exitIntent: false, surgicalDiscounts: false }
        });

        const sdk2 = new SpecterSDKService({
        shopId: 'test-shop-123',
        moduleTier: 'free',
        features: { sessionTracking: true, basicNudges: false, exitIntent: false, surgicalDiscounts: false }
        });

        const session1 = sdk1.trackSession();
        const session2 = sdk2.trackSession();
        
        expect(session1.sessionId).not.toBe(session2.sessionId);
    });
    });
    // tests/unit/services/specter-sdk.service.test.ts

    describe('Nudge Engine', () => {
        test('should not show nudges in free tier', () => {
            const sdk = new SpecterSDKService({
            shopId: 'test-shop-123',
            moduleTier: 'free',
            features: { sessionTracking: true, basicNudges: false, exitIntent: false, surgicalDiscounts: false }
            });

            const shouldShowNudge = sdk.shouldShowNudge('exit_intent');
            
            expect(shouldShowNudge).toBe(false);
        });

        test('should show nudges in specter tier when feature enabled', () => {
            const sdk = new SpecterSDKService({
            shopId: 'test-shop-123',
            moduleTier: 'specter', 
            features: { sessionTracking: true, basicNudges: true, exitIntent: true, surgicalDiscounts: false }
            });

            // Mock high intent session
            jest.spyOn(sdk, 'calculateIntentScore').mockReturnValue(0.85);
            
            const shouldShowNudge = sdk.shouldShowNudge('exit_intent');
            
            expect(shouldShowNudge).toBe(true);
        });

        test('should respect feature flags for nudge types', () => {
            const sdk = new SpecterSDKService({
            shopId: 'test-shop-123',
            moduleTier: 'specter',
            features: { sessionTracking: true, basicNudges: true, exitIntent: false, surgicalDiscounts: false }
            });

            // Even with high intent, exit intent should be disabled
            jest.spyOn(sdk, 'calculateIntentScore').mockReturnValue(0.85);
            
            const shouldShowNudge = sdk.shouldShowNudge('exit_intent');
            
            expect(shouldShowNudge).toBe(false);
        });

        test('should require high intent for nudges in specter tier', () => {
            const sdk = new SpecterSDKService({
                shopId: 'test-shop-123',
                moduleTier: 'specter',
                features: { sessionTracking: true, basicNudges: true, exitIntent: true, surgicalDiscounts: false }
            });

            // Mock low intent session by calling trackSession after mock
            jest.spyOn(sdk, 'calculateIntentScore').mockReturnValue(0.3);
            sdk.trackSession(); // This updates sessionData with the mocked intent score
            
            const shouldShowNudge = sdk.shouldShowNudge('exit_intent');
            
            expect(shouldShowNudge).toBe(false);
        });
    });
});