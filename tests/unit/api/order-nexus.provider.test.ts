// tests/unit/api/order-nexus.provider.test.ts

import { ReadinessSignal } from '@lasyncro/shared';
import db from 'api-src/db';
import { orderNexusOnboardingSignalProvider } from '../../../apps/backend/src/onboarding/readiness.providers';

// Mock the Knex instance used in readiness.providers.ts
jest.mock('api-src/db', () => {
  const dbMock = jest.fn();
  return {
    __esModule: true,
    default: dbMock,
  };
});

type DbMock = jest.Mock;

describe('orderNexusOnboardingSignalProvider', () => {
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

  it('returns 0 ordersIngested and profitabilityActive=false when there are no canonical orders', async () => {
    const { where } = setupDbMock('0');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
    });
    const signalMap = extractSignals(signals);

    expect(where).toHaveBeenCalledWith({ shop_id: shopId });

    const ordersIngested = signalMap.get('orderNexus.ordersIngested');
    const profitabilityActive = signalMap.get(
      'orderNexus.profitabilityActive'
    );

    expect(ordersIngested).toBeDefined();
    expect(ordersIngested!.value).toBe(0);

    expect(profitabilityActive).toBeDefined();
    expect(profitabilityActive!.value).toBe(false);
  });

  it('sets profitabilityActive=true when there is at least one canonical order', async () => {
    setupDbMock('3');

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
    });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('orderNexus.ordersIngested')!.value).toBe(3);
    expect(signalMap.get('orderNexus.profitabilityActive')!.value).toBe(true);
  });

  it('handles undefined count row gracefully', async () => {
    setupDbMock(undefined);

    const signals = await orderNexusOnboardingSignalProvider.getSignals({
      shopId,
    });
    const signalMap = extractSignals(signals);

    expect(signalMap.get('orderNexus.ordersIngested')!.value).toBe(0);
    expect(signalMap.get('orderNexus.profitabilityActive')!.value).toBe(false);
  });
});
