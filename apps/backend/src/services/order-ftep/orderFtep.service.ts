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

import { BlockedRevenueClassification } from '../order-execution-intelligence/blockedRevenue.classification';
import type {
  FT2ObligationsExposure,
  OrderFtepInput,
  OrderNexusFT2Exposure,
} from './orderFtep.types';

export function exposeOrderNexusFT2(
  input: OrderFtepInput
): OrderNexusFT2Exposure {
  const { intelligence, facts } = input;

  const exposure: OrderNexusFT2Exposure = {
    context: {
      ordersObserved: facts.ordersObserved,
    },

  /**
   * FT2 Totals (Downgraded)
   * ----------------------
   * - Currency is NOT inferable in FT2 → must not be exposed.
   * - Totals are magnitude-only, observational.
   */
  totals: {
    revenueTotal: facts.totals.revenueTotal,
    /**
     * costTotal is a non-existent fact in Orders FT2.
     * Enforced null to prevent accidental upstream leakage.
     */
    costTotal: null,
  },

  /**
   * Data Coverage (FT2)
   * ------------------
   * Coverage is L1-gated.
   * Intelligence may compute usability, but FT2 exposes
   * downgraded factual coverage only.
   *
   * unknown → null (fail-closed)
   */
  dataCoverage: {
    completenessPct:
      facts.dataCoverage?.completenessPct ?? null,
  },

  visibility:
    intelligence.visibility.status === 'unknown'
      ? null
      : { status: intelligence.visibility.status },
};

  return exposure;
}

/**
 * FTEP — Obligation Downgrade
 * --------------------------
 * Downgrades L2 obligation intelligence into FT2-safe exposure.
 *
 * Hard rules:
 * - Full classification required
 * - Sums must match total blocked revenue
 * - Otherwise: fail closed
 */
export function downgradeObligations(
  input: BlockedRevenueClassification | null,
  revenueBlockedTotal: number | null,
): FT2ObligationsExposure {

  console.debug('[FT2 DEBUG][FTEP] downgradeObligations input', {
    input,
    revenueBlockedTotal,
  });

    if (
      !input ||
      revenueBlockedTotal == null ||
      revenueBlockedTotal !== input.totalBlockedValue ||
      (
        // Phase 3 rule:
        // Allow inventory-only downgrade even when classification is incomplete
        input.coverage.classifiedPct !== 1 &&
        !(
          input.coverage.inventoryCoveragePct === 1 &&
          input.buckets?.inventory === input.totalBlockedValue
      )
    )
  ) {
    return {
      totalBlockedValue: null,
      blockedBy: null,
      coverage: { status: 'insufficient' },
    };
  }

 const buckets = input.buckets ?? {};

const {
  inventory = 0,
  customer = 0,
  operational = 0,
  other = 0,
} = buckets;

  const sum =
    inventory + customer + operational + other;

  if (sum !== input.totalBlockedValue) {
    return {
      totalBlockedValue: null,
      blockedBy: null,
      coverage: { status: 'insufficient' },
    };
  }

  return {
    totalBlockedValue: input.totalBlockedValue,
    blockedBy: {
      inventory,
      customer,
      operational,
      other,
    },
    coverage: { status: 'sufficient' },
  };
}
