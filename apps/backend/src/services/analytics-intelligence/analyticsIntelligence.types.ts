// apps/backend/src/services/analytics-intelligence/analyticsIntelligence.types.ts

/**
 * AnalyticsIntelligence
 *
 * Layer 2 — Observability Intelligence (NOT business intelligence)
 *
 * Purpose:
 * - Classify raw observability facts into structured, conservative states
 * - Preserve ambiguity
 * - NEVER judge performance or outcomes
 *
 * This shape is intentionally richer than FT2 exposure.
 * FTEP will decide what survives.
 */
export interface AnalyticsIntelligence {
  snapshot: {
    id: string;
    extractedAt: string;
  };

  domains: {
    // All domains are intelligence-bearing.
    // Ambiguity is encoded via 'unknown', never via null.
    orders: AnalyticsDomainIntelligence;
    products: AnalyticsDomainIntelligence;
    customers: AnalyticsDomainIntelligence;
    finances: AnalyticsDomainIntelligence;
  };
}

/**
 * AnalyticsDomainIntelligence
 *
 * Describes HOW observable a domain is — not how good it is.
 */
export interface AnalyticsDomainIntelligence {
  /**
   * Presence classification
   * - present  → at least one observable fact
   * - absent   → explicitly zero facts
   * - unknown  → no visibility / no data
   */
  presence: 'present' | 'absent' | 'unknown';

  /**
   * Observation level
   * Volume-only classification.
   * No thresholds imply quality.
   */
  observationLevel: 'none' | 'low' | 'partial' | 'full' | 'unknown';

  /**
   * Continuity of observability within the window.
   * This is NOT trend or performance.
   */
  continuity: 'continuous' | 'intermittent' | 'missing' | 'unknown';

  /**
   * Raw timestamps forwarded for FTEP/UI eligibility.
   */
  timestamps: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };

  /**
   * Raw observability counters.
   * These MUST remain unmodified.
   */
  raw: {
    observationCount: number | null;
    nullSurface: number | null;
  };
}
