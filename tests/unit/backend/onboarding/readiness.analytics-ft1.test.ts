//tests/unit/backend/onboarding/readiness.analytics-ft1.test.ts

import db from 'api-db';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';

describe('FT1 readiness — Analytics module', () => {
  const shopId = 6001;
  const userId = 9001;

  const service = new OnboardingReadinessService();

  beforeEach(async () => {
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('canonical_products').where({ shop_id: shopId }).del();
    await db('integrations').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });
  });

  it('blocks FT1 when analytics base data is incomplete', async () => {
    // only orders
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-ft1-analytics-1',
      platformOrderId: 'shopify-order-ft1-analytics-1',
    });

    const snapshot = await service.getSnapshot({ shopId, userId });

    expect(snapshot.ft1.isComplete).toBe(false);
    expect(snapshot.ft1.blockingModules).toContain('analytics');
  });

  it('unblocks FT1 when analytics base data is ready', async () => {
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-ft1-analytics-2',
      platformOrderId: 'shopify-order-ft1-analytics-2',
    });

    await seedCanonicalProduct({
      shopId,
      platformProductId: 'shopify-product-1',
    });

    const snapshot = await service.getSnapshot({ shopId, userId });

    expect(snapshot.ft1.blockingModules).not.toContain('analytics');
    expect(snapshot.ft1.readyModules).toContain('analytics');
  });
});