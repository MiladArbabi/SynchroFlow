import { getCustomersFt2Snapshot } from '../../services/customers-ft2.provider.js';
import { CustomersFT2Exposure } from '../../services/customers-ftep/customersFtep.types.js';
import { getOrderNexusFt2StateSnapshot } from '../../services/order-nexus-ft2/orderNexusFt2.state.resolver.js';
import { OrderNexusFT2Snapshot } from '../../services/order-nexus-ft2/orderNexusFt2.types.js';
import { getProductsFt2Snapshot } from '../../services/products-ft2.provider.js';
import { ProductsFT2Exposure } from '../../services/products-ftep/ProductsFtep.types.js';
import { FT2RangeInput, resolveFt2Range } from '@lasyncro/backend-core/utils/ft2Period.js';
import type { Tier } from '@lasyncro/backend-core/config/tiers.js';
import { getOverviewPulse, OverviewPulse } from '../overview-ft2/overviewPulse.resolver.js';
type OverviewTimingStage =
  | 'orders'
  | 'products'
  | 'customers'
  | 'pulse';

function overviewElapsedMs(startedAt: bigint): number {
  return Math.round(
    Number(process.hrtime.bigint() - startedAt) / 1_000_000
  );
}

export interface OverviewModulesFt2Snapshot {
  orders: OrderNexusFT2Snapshot | null;
  products: ProductsFT2Exposure | null;
  customers: CustomersFT2Exposure | null;
  pulse: OverviewPulse | null;
}
/**
 * OverviewModules FT2
 * ------------------
 * Independent FT2 module visibility surface.
 *
 * RULES:
 * - No trust gating
 * - No completion gating
 * - No aggregation
 * - No interpretation
 *
 * Each module is evaluated independently.
 */
export async function getOverviewModulesFt2Snapshot(input: {
  shopId: number;
  range: FT2RangeInput;
  tier?: Tier;
}): Promise<OverviewModulesFt2Snapshot> {
  const totalStartedAt = process.hrtime.bigint();

  const durationsMs: Partial<Record<OverviewTimingStage, number>> = {};
  let outcome: 'ok' | 'error' = 'error';
  let failedStage: OverviewTimingStage | null = null;

  async function measure<T>(
    stage: OverviewTimingStage,
    task: () => Promise<T>
  ): Promise<T> {
    const startedAt = process.hrtime.bigint();

    try {
      return await task();
    } catch (error) {
      failedStage = stage;
      throw error;
    } finally {
      durationsMs[stage] = overviewElapsedMs(startedAt);
    }
  }

  try {
    const { shopId } = input;
    const period = resolveFt2Range(input.range, input.tier);

    // Preserve existing sequential execution and transaction ownership.
    const snapshot = {
      orders: await measure('orders', () =>
        getOrderNexusFt2StateSnapshot(shopId)
      ),
      products: await measure('products', () =>
        getProductsFt2Snapshot({ shopId, period })
      ),
      customers: await measure('customers', () =>
        getCustomersFt2Snapshot({ shopId, period })
      ),
      pulse: await measure('pulse', () =>
        getOverviewPulse(shopId)
      ),
    };

    outcome = 'ok';
    return snapshot;
  } finally {
    // Temporary Gate 0 diagnostics.
    // One structured log per request; no tenant IDs or customer data.
    // Logging failures must never change the endpoint outcome.
    try {
      console.info(
        '[GATE0_OVERVIEW_TIMING]',
        JSON.stringify({
          outcome,
          failed_stage: failedStage,
          total_ms: overviewElapsedMs(totalStartedAt),
          ...durationsMs,
        })
      );
    } catch {
      // Diagnostic logging is non-critical.
    }
  }
}