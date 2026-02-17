// tests/unit/backend/onboarding/readiness.signal-passthrough.test.ts
import db from '@lasyncro/backend-core/db.js';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { specterOnboardingSignalProvider } from 'api-src/onboarding/providers/specter.provider';

describe('OnboardingReadinessService – signal passthrough', () => {
  afterEach(async () => {
    await db('products').del();
    await db('users').del();
    await db('shops').del();
  });

  const shopId = 1234;

  it('includes provider signals for modules with empty requiredSignals', async () => {
    // Arrange
    const service = new OnboardingReadinessService();

    // Act
    const snapshot = await service.getSnapshot({ shopId });

    const specterModule = snapshot.modules.find(
      m => m.moduleId === 'specter'
    );

    // Assert
    expect(specterModule).toBeDefined();

    const signalNames = (specterModule?.signals ?? []).map(s => s.name);

    expect(signalNames).toContain('specter.sessionsKnown');
    expect(signalNames).toContain('specter.sessionCount');
    expect(signalNames).toContain('specter.signalConfidence');
  });
  it('passes through HEALTHY sku-os product signals when canonical products exist', async () => {
    const shopId = 5678;
    const userId = 6789;

    await seedShopAndUser({ shopId, userId });
    await seedCanonicalProduct({ shopId });

    const service = new OnboardingReadinessService();
    const snapshot = await service.getSnapshot({ shopId });

    const skuModule = snapshot.modules.find(
      m => m.moduleId === 'sku-os'
    );

    expect(skuModule).toBeDefined();

    const productsKnown = skuModule?.signals.find(
      s => s.name === 'sku-os.productsKnown'
    );

    const productCount = skuModule?.signals.find(
      s => s.name === 'sku-os.productCount'
    );

    expect(productsKnown?.value).toBe(true);
    expect(productCount?.value).toBeGreaterThan(0);
  });
});
