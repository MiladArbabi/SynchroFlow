/**
 * AnalyticsFT2Exposure
 *
 * Public FT2 contract for Analytics.
 *
 * Rules:
 * - Data-only
 * - Null = intentional absence
 * - No intelligence
 * - No lifecycle semantics
 */
export interface AnalyticsFT2Exposure {
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    orders: AnalyticsDomainExposure | null;
    products: AnalyticsDomainExposure | null;
    customers: AnalyticsDomainExposure | null;
    finances: AnalyticsDomainExposure | null;
  };
}

export interface AnalyticsDomainExposure {
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}