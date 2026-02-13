/**
 * Finances FT1 onboarding signal provider
 *
 * Purpose (FT1 only):
 * - Surface whether financial primitives are PRESENT and KNOWN
 * - Do NOT compute finance logic
 * - Do NOT infer insights
 *
 * Canonical sources (verified by scans):
 * - canonical_orders → transaction existence
 * - canonical_order_line_items.estimated_unit_cost → cost readiness
 */

import db from '../../db';
import { ReadinessSignal } from '@lasyncro/shared';
import type { OnboardingSignalProvider } from '../readiness.providers';

export const financesOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'finances',

  async getSignals({ shopId }): Promise<ReadinessSignal[]> {
    /**
     * 1. Count canonical transactions (orders)
     *    We only care if the count is KNOWN.
     */
    const ordersRow = await db('orders')

      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const transactionCount =
      ordersRow?.count != null ? Number(ordersRow.count) : null;

    /**
     * 2. Detect missing cost data
     *    Any NULL estimated_unit_cost means costs are NOT ready.
     */
    const missingCostRow = await db('canonical_order_line_items')
      .where({ shop_id: shopId })
      .whereNull('estimated_unit_cost')
      .count<{ count: string }>('id as count')
      .first();

    const missingCostCount =
      missingCostRow?.count != null ? Number(missingCostRow.count) : null;

    // Debug instrumentation — safe, low-volume
    console.debug('[finances][ft1]', {
      shopId,
      transactionCount,
      missingCostCount,
    });

    return [
      { name: 'finances.transactionCount', value: transactionCount },
      { name: 'finances.missingCostCount', value: missingCostCount },
    ];
  },
};