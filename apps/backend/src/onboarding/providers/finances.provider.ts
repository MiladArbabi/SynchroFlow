/**
 * Finances FT1 onboarding signal provider
 *
 * Purpose (FT1 only):
 * - Surface whether financial primitives are PRESENT and KNOWN
 * - Do NOT compute finance logic
 * - Do NOT infer insights
 *
 * Sources (verified by scans):
 * - orders → transaction existence
 * - variants.unit_cost → catalog cost completeness
 */

import db from '@lasyncro/backend-core/db.js';
import { ReadinessSignal } from '@lasyncro/shared';
import type { OnboardingSignalProvider } from '../readiness.providers.js';

export const financesOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'finances',

  async getSignals({ shopId }): Promise<ReadinessSignal[]> {
    /**
     *.   Count transactions (orders)
     *    We only care if the count is KNOWN.
     */
    const ordersRow = await db('orders')

      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    const transactionCount =
      ordersRow?.count != null ? Number(ordersRow.count) : null;

    /**
     * CATALOG COST COMPLETENESS CHECK
     * --------------------------------
     * Financial readiness must be evaluated from the
     * canonical catalog source of truth:
     *
     *   variants.unit_cost
     *
     * NOT from historical revenue snapshots
     * (variants.unit_cost).
     *
     * Reason:
     * - Merchants may have products but no orders yet
     * - Missing costs must be detected before any orders exist
     * - variants is the canonical catalog layer
     */
    const missingCostRow = await db('variants as v')
      .where('v.shop_id', shopId)
      .where('v.unit_cost', 0)
      .count<{ count: string }>('v.lasyncro_variant_id as count')
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