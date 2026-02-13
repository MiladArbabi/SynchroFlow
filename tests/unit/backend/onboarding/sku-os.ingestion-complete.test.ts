// tests/unit/backend/onboarding/sku-os.ingestion-complete.test.ts

import db from 'api-db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';

describe('SKU-OS readiness after ingestion completion', () => {
  const shopId = 9001;
  const userId = 9002;

  afterEach(async () => {
    await db('products').del();
    await db('shop_ingestion_events').del();
    await db('users').del();
    await db('shops').del();
  });

  it('reports productCount > 0 once sku-os ingestion is completed', async () => {
    await seedShopAndUser({ shopId, userId });

    // canonical products exist
    await seedCanonicalProduct({ shopId });
    await seedCanonicalProduct({ shopId });

    // ingestion completion event
    await db('shop_ingestion_events').insert({
      shop_id: shopId,
      module_id: 'sku-os',
      event: 'ingestion_completed',
    });

    const service = new OnboardingReadinessService();
    const snapshot = await service.getSnapshot({ shopId });

    const skuOs = snapshot.modules.find(m => m.moduleId === 'sku-os');
    const productCount = skuOs?.signals.find(s => s.name === 'sku-os.productCount')?.value;

    expect(productCount).toBe(2);
  });
});