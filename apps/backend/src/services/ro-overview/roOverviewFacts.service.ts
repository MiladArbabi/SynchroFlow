/**
  * RO-Overview — Facts Layer (Meta-Facts)
  *
  * ⚠️ HARD CONSTRAINTS:
  * - Observes FT2 snapshot presence ONLY
  * - Never reads databases
  * - Never derives meaning
  * - Never invents defaults
  * - Never expands beyond presence signals
  *
  * This is NOT a canonical Facts layer.
  * Any additional fields require architectural review.
  */

export type ROOverviewFacts = {
  trustSurfacePresent: boolean | null;
  trustEligibleObserved: boolean | null;
  ordersSurfacePresent: boolean | null;
};

export function buildROOverviewFacts(input: {
  trustFt2: any | null;
  ordersFt2: any | null;
}): ROOverviewFacts {
  try {
    return {
      trustSurfacePresent: input.trustFt2 !== null,
      trustEligibleObserved: input.trustFt2?.trustEligible ?? null,
      ordersSurfacePresent: input.ordersFt2 !== null,
    };
  } catch {
    return {
      trustSurfacePresent: null,
      trustEligibleObserved: null,
      ordersSurfacePresent: null,
    };
  }
}