/**
 * Finances FT1 — Provider behavior (RED)
 *
 * Purpose:
 * - Define the expected FT1 readiness behavior for Finances
 * - Fail until the Finances onboarding provider is implemented and registered
 *
 * FT1 invariants:
 * - No finance logic
 * - Only known vs unknown
 * - Uses canonical_orders + canonical_order_line_items only
 *
 * Signals under test:
 * - finances.transactionCount
 * - finances.costDataReady
 * - finances.baseSignalsReady
 */

import db from 'api-db';
import { onboardingSignalProviders } from 'api-src/onboarding/readiness.providers';

import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedCanonicalOrder } from '../../helpers/seedCanonicalOrder';
import { seedCanonicalOrderLineItem } from '../../helpers/seedCanonicalOrderLineItem';

describe('Finances FT1 provider (behavior)', () => {
  const shopId = 9101;
  const userId = 9201;

  beforeEach(async () => {
    await seedShopAndUser({ shopId, userId });
  });

  afterEach(async () => {
    await db('canonical_order_line_items').where({ shop_id: shopId }).del();
    await db('canonical_orders').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();
  });

  function getFinancesProvider() {
    const provider = onboardingSignalProviders.find(
      (p) => p.moduleId === 'finances'
    );

    // RED: this SHOULD be defined once provider is implemented
    expect(provider).toBeDefined();

    return provider!;
  }

  test('no transactions → transactionCount=0, baseSignalsReady=false', async () => {
    const provider = getFinancesProvider();

    const signals = await provider.getSignals({ shopId });

    expect(signals).toEqual(
      expect.arrayContaining([
        { name: 'finances.transactionCount', value: 0 },
        { name: 'finances.baseSignalsReady', value: false },
      ])
    );
  });

  test('transactions exist but missing costs → costDataReady=false', async () => {
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'fin-order-1',
    });

    await seedCanonicalOrderLineItem({
      shopId,
      canonicalOrderId: 'fin-order-1',
      estimatedUnitCost: null,
    });

    const provider = getFinancesProvider();
    const signals = await provider.getSignals({ shopId });

    expect(signals).toEqual(
      expect.arrayContaining([
        { name: 'finances.transactionCount', value: 1 },
        { name: 'finances.costDataReady', value: false },
        { name: 'finances.baseSignalsReady', value: false },
      ])
    );
  });

  test('transactions exist and all costs present → baseSignalsReady=true', async () => {
    await seedCanonicalOrder({
      shopId,
      canonicalOrderId: 'fin-order-2',
    });

    await seedCanonicalOrderLineItem({
      shopId,
      canonicalOrderId: 'fin-order-2',
      estimatedUnitCost: 15.0,
    });

    const provider = getFinancesProvider();
    const signals = await provider.getSignals({ shopId });

    expect(signals).toEqual(
      expect.arrayContaining([
        { name: 'finances.transactionCount', value: 1 },
        { name: 'finances.costDataReady', value: true },
        { name: 'finances.baseSignalsReady', value: true },
      ])
    );
  });
});
