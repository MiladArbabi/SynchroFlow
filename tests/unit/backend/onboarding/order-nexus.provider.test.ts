import db from '@lasyncro/backend-core/db.js';
import { orderNexusOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';
import { seedCanonicalOrderLineItem } from '../../helpers/seedCanonicalOrderLineItem';

describe('OrderNexus Onboarding Signal Provider (DB → signals)', () => {
  const shopId = 4001;
  const userId = 9001;

  beforeEach(async () => {
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('canonical_order_line_items').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();

    await seedShopAndUser({ shopId, userId });
  });

  it('emits ordersKnown=true and ordersIngested=0 when no orders exist', async () => {
    const signals = await orderNexusOnboardingSignalProvider.getSignals({ shopId });

    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['orderNexus.ordersKnown']).toBe(true);
    expect(map['orderNexus.ordersIngested']).toBe(0);
    expect(map['orderNexus.profitabilityActive']).toBe(false);
  });

  it('emits correct ordersIngested when orders exist', async () => {
    await seedCanonicalOrder({
        shopId,
        canonicalOrderId: 'order-001-test-1',
        platformOrderId: 'shopify-order-001-test-1',
    });
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'order-001-test-2',
      platformOrderId: 'shopify-order-001-test-2',
    });

    const signals = await orderNexusOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['orderNexus.ordersKnown']).toBe(true);
    expect(map['orderNexus.ordersIngested']).toBe(2);
    expect(map['orderNexus.profitabilityActive']).toBe(true);
  });

  it('defaults missingCostCount to 0 when no line items exist', async () => {
    await seedCanonicalOrder({
        shopId,
        canonicalOrderId: 'order-001-test-3',
        platformOrderId: 'shopify-order-001-test-3',
    });

    const signals = await orderNexusOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['orderNexus.missingCostCount']).toBe(0);
  });
  it('emits missingCostCount > 0 when line items have no estimated cost', async () => {
    const canonicalOrderId = 'order-missing-cost-1';

    await seedCanonicalOrder({
        shopId,
        canonicalOrderId,
        platformOrderId: 'shopify-missing-cost-1',
    });

    await seedCanonicalOrderLineItem({
        shopId,
        canonicalOrderId,
        estimatedUnitCost: null, 
    });

    const signals = await orderNexusOnboardingSignalProvider.getSignals({ shopId });
    const map = Object.fromEntries(signals.map(s => [s.name, s.value]));

    expect(map['orderNexus.ordersIngested']).toBe(1);
    expect(map['orderNexus.missingCostCount']).toBe(1);
    });
});