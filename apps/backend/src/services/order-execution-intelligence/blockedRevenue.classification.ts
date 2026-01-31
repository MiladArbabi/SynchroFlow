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
    classifiedPct: number; // 0–1
    unknownValue: number;
  };
};
