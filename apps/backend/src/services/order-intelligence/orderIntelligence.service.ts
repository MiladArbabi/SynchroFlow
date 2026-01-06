// apps/backend/src/services/order-intelligence/orderIntelligence.service.ts

/**
 * Order Intelligence Service (Layer 2)
 * -----------------------------------
 * Purpose:
 * - Convert raw, factual order metrics into classified intelligence.
 *
 * Guarantees:
 * - NO database access
 * - NO UI formatting
 * - NO inference when facts are missing
 * - Deterministic output
 *
 * This layer may:
 * - Classify (good / bad / unknown)
 * - Derive directional signals (up / down / flat)
 *
 * This layer may NOT:
 * - Explain causality
 * - Recommend actions
 * - Expose narratives
 */

import type { OrderFacts } from '../order-facts/orderFacts.types';

/* ----------------------------------------
 * Intelligence Types (INTERNAL ONLY)
 * ------------------------------------- */

export type OrderHealthStatus =
  | 'healthy'
  | 'at_risk'
  | 'loss'
  | 'unknown';

export type TrendDirection =
  | 'up'
  | 'down'
  | 'flat'
  | 'unknown';

export interface OrderNexusIntelligence {
  ordersObserved: number | null;

  margin: {
    averagePct: number | null;
    status: OrderHealthStatus;
  };

  loss: {
    exists: boolean | null;
  };

  trend: {
    direction: TrendDirection;
  };

  dataCoveragePct: number | null;
}

/* ----------------------------------------
 * Intelligence Derivation
 * ------------------------------------- */

/**
 * deriveOrderIntelligence
 * -----------------------
 * Pure transformation from OrderFacts → OrderNexusIntelligence
 */
export function deriveOrderIntelligence(
  facts: OrderFacts
): OrderNexusIntelligence {
  console.debug('[OrderIntelligence] input facts', facts);

  const intelligence: OrderNexusIntelligence = {
    ordersObserved: facts.ordersObserved ?? null,

    margin: {
      averagePct: null,
      status: 'unknown',
    },

    loss: {
      exists: null,
    },

    trend: {
      direction: 'unknown',
    },

    dataCoveragePct: facts.dataCoverage.completenessPct ?? null,
  };

  console.debug('[OrderIntelligence] derived intelligence', intelligence);
  return intelligence;
}