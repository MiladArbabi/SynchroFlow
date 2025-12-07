// tests/unit/api/sku-os.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { skuOsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

// We need to mock the Knex instance imported as `db` in readiness.providers.ts
jest.mock('api-src/db', () => {
  const dbMock = jest.fn();
  return {
    __esModule: true,
    default: dbMock,
  };
});

import db from 'api-src/db';

type DbMock = jest.Mock;

describe('skuOsOnboardingSignalProvider', () => {
  const shopId = 1;

  const setupDbMock = (countValue: string | undefined) => {
    const first = jest.fn().mockResolvedValue(
      countValue === undefined ? undefined : { count: countValue }
    );
    const count = jest.fn().mockReturnValue({ first });
    const where = jest.fn().mockReturnValue({ count });

    (db as unknown as DbMock).mockReturnValue({
      where,
      count,
      first,
    });

    return { where, count, first };
  };

  const extractSignals = (signals: ReadinessSignal[]) => {
    const map = new Map<string, ReadinessSignal>();
    signals.forEach((s) => map.set(s.name, s));
    return map;
  };

  beforeEach(() => {
    (db as unknown as DbMock).mockReset();
  });

  it('returns 0 productCount and inventoryInsightsReady=false when there are no products', async () => {
    const { where } = setupDbMock('0');

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });
    const signalMap = extractSignals(signals);

    expect(where).toHaveBeenCalledWith({ shop_id: shopId });

    const productCount = signalMap.get('skuOs.productCount');
    const inventoryReady = signalMap.get('skuOs.inventoryInsightsReady');

    expect(productCount).toBeDefined();
    expect(productCount!.value).toBe(0);
    expect(inventoryReady).toBeDefined();
    expect(inventoryReady!.value).toBe(false);
  });

  it('sets inventoryInsightsReady=false when productCount is below threshold', async () => {
    // 3 products, still below our "interesting inventory" threshold (5)
    setupDbMock('3');

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('skuOs.productCount')!.value).toBe(3);
    expect(signalMap.get('skuOs.inventoryInsightsReady')!.value).toBe(false);
  });

  it('sets inventoryInsightsReady=true when productCount reaches threshold', async () => {
    // 5 products: threshold for inventory insights
    setupDbMock('5');

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('skuOs.productCount')!.value).toBe(5);
    expect(signalMap.get('skuOs.inventoryInsightsReady')!.value).toBe(true);
  });

  it('handles undefined count row gracefully', async () => {
    // simulate no row returned from DB
    setupDbMock(undefined);

    const signals = await skuOsOnboardingSignalProvider.getSignals({ shopId });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('skuOs.productCount')!.value).toBe(0);
    expect(signalMap.get('skuOs.inventoryInsightsReady')!.value).toBe(false);
  });
});
