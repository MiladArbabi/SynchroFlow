// tests/unit/services/specter-end-to-end.test.ts
import { ShopifyAppService } from 'api-src/services/shopify-app.service';
import { SpecterSDKService } from 'api-src/services/specter-sdk.service';

describe('Specter End-to-End Flow', () => {
  test('should provide complete free→specter upgrade path', async () => {
    // 1. Free tier installation
    const freeScript = await ShopifyAppService.createSpecterScript('shop-123', 'free');
    expect(freeScript).toContain('"moduleTier":"free"');
    
    // 2. Free tier SDK behavior
    const freeSDK = new SpecterSDKService({
      shopId: 'shop-123',
      moduleTier: 'free',
      features: { sessionTracking: true, basicNudges: false, exitIntent: false, surgicalDiscounts: false }
    });
    
    const freeSession = freeSDK.trackSession();
    expect(freeSession.moduleTier).toBe('free');
    expect(freeSDK.shouldShowNudge('exit_intent')).toBe(false);

    // 3. Specter tier upgrade
    const specterScript = await ShopifyAppService.createSpecterScript('shop-123', 'specter');
    expect(specterScript).toContain('"moduleTier":"specter"');
    
    // 4. Specter tier SDK behavior
    const specterSDK = new SpecterSDKService({
      shopId: 'shop-123',
      moduleTier: 'specter',
      features: { sessionTracking: true, basicNudges: true, exitIntent: true, surgicalDiscounts: false }
    });

    // Mock high intent for specter tier
    jest.spyOn(specterSDK, 'calculateIntentScore').mockReturnValue(0.85);
    const specterSession = specterSDK.trackSession();
    
    expect(specterSession.moduleTier).toBe('specter');
    expect(specterSession.intentScore).toBeGreaterThan(0.7);
    expect(specterSDK.shouldShowNudge('exit_intent')).toBe(true);
    
    // 5. Nudge configuration
    const nudgeConfig = specterSDK.getNudgeConfiguration('exit_intent');
    expect(nudgeConfig).toHaveProperty('discountPercentage', 10);
  });
});