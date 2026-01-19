export interface AnalyticsFacts {
  shopId: number;

  snapshotId: string;
  extractedAt: string;

  domains: {
    // Orders observability substrate
    orders: AnalyticsDomainFacts;

    // Products observability substrate
    products: AnalyticsDomainFacts;

    // Customers observability substrate
    customers: AnalyticsDomainFacts;

    // Finances observability substrate
    finances: AnalyticsDomainFacts;
  };
}

/**
 * AnalyticsDomainFacts
 *
 * Canonical Layer 1 observability shape.
 *
 * Rules:
 * - Presence ≠ readiness
 * - Count ≠ performance
 * - null ≠ 0
 * - Time = observation span, not business period
 * - firstSeenAt / lastSeenAt may be null when sourced from FT2
 */
export interface AnalyticsDomainFacts {
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}