// tests/unit/backend/onboarding/sku-os.provider.test.ts

import db from 'api-db';
import { skuOsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';

describe('sku-os onboarding provider', () => {
  const shopId = 1001;
  const userId = 2001;

  afterEach(async () => {
    await db('products').del();
    await db('users').del();
    await db('shops').del();
  });

  it('emits productsKnown=true and productCount=0 when canonical_products query runs and table is empty', async () => {
    await seedShopAndUser({ shopId, userId });

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });

    const productsKnown = signals.find(s => s.name === 'sku-os.productsKnown');
    const productCount = signals.find(s => s.name === 'sku-os.productCount');

    expect(productsKnown?.value).toBe(true);
    expect(productCount?.value).toBe(0);
  });

  it('emits productsKnown=true and productCount>0 when canonical products exist', async () => {
    await seedShopAndUser({ shopId, userId });
    await seedCanonicalProduct({ shopId });

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });

    const productsKnown = signals.find(s => s.name === 'sku-os.productsKnown');
    const productCount = signals.find(s => s.name === 'sku-os.productCount');

    expect(productsKnown?.value).toBe(true);
    expect(productCount?.value).toBe(1);
  });
});
