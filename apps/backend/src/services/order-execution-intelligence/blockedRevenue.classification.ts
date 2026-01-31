/**
 * L2 — Blocked Revenue Classification
 * ----------------------------------
 * Internal intelligence only.
 *
 * Purpose:
 * - Classify blocked revenue by obligation type
 * - Preserve full expressiveness
 *
 * NOT exposed to FT2.
 * NOT downgraded here.
 */
export type BlockedRevenueClassification = {
  totalBlockedValue: number;

  buckets: {
    inventory?: number;
    customer?: number;
    operational?: number;
    other?: number;
  };

  coverage: {
    /**
     * % of blocked revenue whose obligation
     * category is known (any bucket).
     */
    classifiedPct: number;

    /**
     * Inventory obligation coverage
     * -----------------------------
     * % of blocked revenue whose line items
     * had sufficient inventory truth to evaluate.
     *
     * This is epistemic coverage, NOT blockage rate.
     */
    inventoryCoveragePct: number;

    /**
     * Blocked revenue with no obligation attribution.
     */
    unknownValue: number;
  };
};
