import db from 'api-db';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';
import { seedCanonicalProduct } from '../../helpers/seedCanonicalProduct';
import { seedIntegration } from '../../helpers/seedIntegration';

// NOTE: provider does NOT exist yet — test must fail
import { analyticsOnboardingSignalProvider } from 'api-src/onboarding/providers/analytics.provider';

describe('Analytics Onboarding Signal Provider (canonical → analytics)', () => {
  const shopId = 5001;
  const userId = 8001;

  beforeEach(async () => {
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('canonical_products').where({ shop_id: shopId }).del();
    await db('integrations').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });
  });

  it('emits zero counts and baseSignalsReady=false when no data exists', async () => {
    const signals = await analyticsOnboardingSignalProvider.getSignals({ shopId });

    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['analytics.orderCount']).toBe(0);
    expect(map['analytics.productCount']).toBe(0);
    expect(map['analytics.baseSignalsReady']).toBe(false);
  });

  it('emits baseSignalsReady=false when only orders exist', async () => {
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-only-1',
      platformOrderId: 'shopify-order-only-1',
    });

    const signals = await analyticsOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['analytics.orderCount']).toBe(1);
    expect(map['analytics.productCount']).toBe(0);
    expect(map['analytics.baseSignalsReady']).toBe(false);
  });

  it('emits baseSignalsReady=false when only products exist', async () => {
    await seedCanonicalProduct({
      shopId,
      platformProductId: 'shopify-product-only-1',
    });

    const signals = await analyticsOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['analytics.orderCount']).toBe(0);
    expect(map['analytics.productCount']).toBe(1);
    expect(map['analytics.baseSignalsReady']).toBe(false);
  });

  it('emits baseSignalsReady=true when both orders and products exist', async () => {
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-1',
      platformOrderId: 'shopify-order-1',
    });

    await seedCanonicalProduct({
      shopId,
      platformProductId: 'shopify-product-1',
    });

    const signals = await analyticsOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['analytics.orderCount']).toBe(1);
    expect(map['analytics.productCount']).toBe(1);
    expect(map['analytics.baseSignalsReady']).toBe(true);
  });
});