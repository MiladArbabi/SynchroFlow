/**
 * AnalyticsModuleFT2DataProps
 * ==========================
 *
 * DATA-ONLY FT2 contract for Analytics.
 *
 * Purpose:
 * - Expose observability substrate ONLY
 * - No intelligence
 * - No interpretation
 * - No business meaning
 *
 * Rules:
 * - Shape-stable
 * - Read-only
 * - Null = intentional absence
 */
export interface AnalyticsModuleFT2DataProps {
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    orders: AnalyticsDomainProps | null;
    products: AnalyticsDomainProps | null;
    customers: AnalyticsDomainProps | null;
    finances: AnalyticsDomainProps | null;
  };
}

/**
 * AnalyticsDomainProps
 *
 * FT2-safe observability surface for a single domain.
 * This type must NEVER include derived meaning.
 */
export interface AnalyticsDomainProps {
  presence: boolean | null;
  observationCount: number | null;
  nullSurface: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/**
 * AnalyticsModuleFT2Props
 * ======================
 *
 * FULL render contract.
 *
 * NOTE:
 * - Currently identical to data props
 * - Separated intentionally for future visual-only extensions
 */
export type AnalyticsModuleFT2Props =
  AnalyticsModuleFT2DataProps;
