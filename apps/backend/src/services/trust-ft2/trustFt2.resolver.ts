/**
 * Trust FT2 — Resolver (SKELETON ONLY)
 * -----------------------------------
 * Authoritative entry point for Trust FT2.
 *
 * STATUS:
 * - Design-complete
 * - Implementation-blocked
 *
 * Trust FT2 is a terminal gate.
 * It decides ONLY whether downstream FT2 realities
 * are epistemically safe to expose.
 *
 * It does NOT explain, rank, score, or advise.
 */

export interface TrustFt2Snapshot {
  dataFreshness: 'fresh' | 'stale' | 'unknown' | null;
  dataIntegrity: 'consistent' | 'inconsistent' | 'unknown' | null;
  trustEligible: boolean | null;
}

/**
 * getTrustFt2Snapshot
 * -------------------
 * Single entry point for Trust FT2.
 *
 * INPUT:
 * - shopId (required)
 *
 * OUTPUT:
 * - TrustFt2Snapshot (fully downgraded, render-safe)
 *
 * HARD RULES (NON-NEGOTIABLE):
 * - No Orders access
 * - No Overview access
 * - No UI awareness
 * - No scoring
 * - No weighting
 * - No explanation
 * - No partial truth
 */
export async function getTrustFt2Snapshot(input: {
  shopId: number;
}): Promise<TrustFt2Snapshot> {
  const { shopId } = input;

  /**
   * Trust FT2 Resolver
   *
   * PURPOSE:
   * - Converge existing FT2-safe trust signals
   * - Expose a single, terminal trust gate
   *
   * HARD RULES:
   * - No facts or intelligence recomputation
   * - Providers only
   * - Backend-owned period
   * - Unknown → null (epistemic silence)
   */

  // FT2 period authority (no UI override)
  const { getFt2Period } = await import(
    'api-src/utils/ft2Period'
  );

  const period = getFt2Period();

  // Providers (explicit, typed)
  const {
    getProductDataIntegritySnapshot,
  } = await import(
    'api-src/services/products-data-integrity.provider'
  );

  /**
   * L1 — Presence (observation only)
   */
  const integrityExposure =
    typeof getProductDataIntegritySnapshot === 'function'
      ? await getProductDataIntegritySnapshot({
          shopId,
          period,
        })
      : null;

  /**
   * Product → Trust semantic mapping (explicit)
   *
   * ProductDataIntegrityFT2Exposure is domain-owned.
   * Trust FT2 must not leak domain semantics downstream.
   *
   * Mapping rules:
   * - ok → consistent
   * - attention → inconsistent
   * - unknown / null → unknown
   *
   * This is NOT inference. It is a contract translation.
   */

  /**
   * L2 — Signal extraction (no inference)
   */
  const dataIntegrity:
  | 'consistent'
  | 'inconsistent'
  | 'unknown'
  | null = (() => {
    if (!integrityExposure) return 'unknown';

    switch (integrityExposure.integrity) {
      case 'ok':
        return 'consistent';
      case 'attention':
        return 'inconsistent';
      case 'unknown':
      default:
        return 'unknown';
    }
  })();

    const {
    getProductDataFreshnessSnapshot,
  } = await import(
    'api-src/services/products-data-freshness.provider'
  );

  const freshnessExposure =
    typeof getProductDataFreshnessSnapshot === 'function'
      ? await getProductDataFreshnessSnapshot({
          shopId,
          period,
        })
      : null;

  /**
   * Trust Freshness Gate (Terminal)
   *
   * Rules:
   * - Any null exposure → unknown
   * - Any unknown value → unknown
   * - All stale → stale
   * - At least one fresh AND none unknown → fresh
   */
  const freshnessValues =
    freshnessExposure?.freshness
      ? Object.values(freshnessExposure.freshness)
      : null;

  const dataFreshness:
    | 'fresh'
    | 'stale'
    | 'unknown'
    | null = (() => {
    if (!freshnessValues) return 'unknown';

    if (freshnessValues.some((v) => v === null)) {
      return 'unknown';
    }

    if (freshnessValues.some((v) => v === 'unknown')) {
      return 'unknown';
    }

    if (freshnessValues.some((v) => v === 'fresh')) {
      return 'fresh';
    }

    return 'stale';
  })();

  /**
   * L3 — Trust Gate (single downgrade boundary)
   *
   * Rules:
   * - Any unknown → null
   * - Any unsafe → false
   * - All safe → true
   */
  let trustEligible: boolean | null = null;

  if (
    dataIntegrity === 'unknown' ||
    dataFreshness === 'unknown'
  ) {
    trustEligible = null;
  } else if (
    dataIntegrity === 'consistent' &&
    dataFreshness === 'fresh'
  ) {
    trustEligible = true;
  } else {
    trustEligible = false;
  }

  /**
   * L4 — Terminal Snapshot (FT2-safe)
   */
  return {
    dataFreshness,
    dataIntegrity,
    trustEligible,
  };
}
