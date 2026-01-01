import db from '../../db';
import { ReadinessSignal } from '@lasyncro/shared';
import type { OnboardingSignalProvider } from '../readiness.providers';

export const analyticsOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'analytics',

  async getSignals({ shopId }) {
    const ordersRow = await db('canonical_orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const productsRow = await db('canonical_products')
      .where({ shop_id: shopId })
      .count<{ count: string }>('* as count')
      .first();

    const orderCount = Number(ordersRow?.count ?? 0);
    const productCount = Number(productsRow?.count ?? 0);

    const baseSignalsReady = orderCount > 0 && productCount > 0;

    return [
      { name: 'analytics.orderCount', value: orderCount },
      { name: 'analytics.productCount', value: productCount },
      { name: 'analytics.baseSignalsReady', value: baseSignalsReady },
    ];
  },
};
