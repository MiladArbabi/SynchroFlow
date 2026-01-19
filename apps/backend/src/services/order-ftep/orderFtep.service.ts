// apps/backend/src/services/order-ftep/orderFtep.service.ts

/**
 * Order FTEP Service (Layer 3)
 * ----------------------------
 * Purpose:
 * - Enforce Truth Exposure Policy.
 *
 * Guarantees:
 * - Intelligence NEVER leaks directly
 * - No causation or explanations
 * - Deterministic downgrade only
 */

import type {
  OrderFtepInput,
  OrderNexusFT2Exposure,
} from './orderFtep.types';

export function exposeOrderNexusFT2(
  input: OrderFtepInput
): OrderNexusFT2Exposure {
  const { intelligence, facts } = input;

  console.debug('[OrderFTEP] input', input);

  const exposure: OrderNexusFT2Exposure = {
  context: {
    ordersObserved: intelligence.ordersObserved,
  },

  totals: {
    revenueTotal: facts.totals.revenueTotal,
    costTotal: facts.totals.costTotal,
    currency: facts.totals.currency,
  },

  outcome:
    intelligence.margin.status === 'unknown'
      ? null
      : {
          status:
            intelligence.margin.status === 'loss'
              ? 'negative'
              : 'positive',
        },

  trend:
    intelligence.trend.direction === 'unknown'
      ? null
      : { direction: intelligence.trend.direction },

  dataCoverage: {
    completenessPct: intelligence.dataCoveragePct ?? null,
  },
};


  console.debug('[OrderFTEP] FT2 exposure', exposure);

  return exposure;
}