import { AnalyticsDomainIntelligence, AnalyticsIntelligence } from '../analytics-intelligence/analyticsIntelligence.types';
import { AnalyticsFT2Exposure } from './analyticsFtep.types';

interface BuildAnalyticsFtepInput {
  intelligence: AnalyticsIntelligence;
}

/**
 * buildAnalyticsFtep
 *
 * Layer 3 — Truth Exposure Policy
 *
 * Responsibilities:
 * - Downgrade intelligence into FT2-safe observability
 * - Suppress meaning, NOT facts
 * - Allow partial, ambiguous visibility
 *
 * CRITICAL:
 * - FTEP never invents data
 * - FTEP never explains data
 */
export function buildAnalyticsFtep(
  input: BuildAnalyticsFtepInput
): AnalyticsFT2Exposure {
  const { intelligence } = input;

  return {
    snapshot: {
      id: intelligence.snapshot.id,
      extractedAt: intelligence.snapshot.extractedAt,
    },

    // IMPORTANT:
    // - Layer 2 ALWAYS emits intelligence for all domains
    // - Layer 3 is the ONLY layer allowed to suppress a domain (→ null)
    // - null here means: "withheld by policy", NOT "unknown"
    domains: {
      // Signal #1 — Orders
      orders: exposeDomain(intelligence.domains.orders),

      // Signal #2 — Products
      products: exposeDomain(intelligence.domains.products),

      // Signal #3 — Customers
      customers: exposeDomain(intelligence.domains.customers),

      // Signal #4 — Finances (presence-only still valid)
      finances: exposeDomain(intelligence.domains.finances),
    },
  };
}

/**
 * exposeDomain
 *
 * Converts observability intelligence → FT2-safe exposure.
 *
 * Suppression rules:
 * - If presence is 'unknown' → entire domain suppressed
 * - Otherwise expose raw observability only
 *
 * This ensures:
 * - Blindness is visible
 * - Ambiguity is preserved
 * - No intelligence leaks
 */
function exposeDomain(
  domain: AnalyticsDomainIntelligence
) {
  // Suppress entire domain when presence cannot be classified.
  // This is a policy decision, not an intelligence failure.

  // NOTE:
  // presence === 'absent' is still meaningful observability.
  // We expose zeros intentionally to distinguish:
  // - known absence (false, 0)
  // - unknown observability (null domain)
  if (domain.presence === 'unknown') {
    return null;
  }

  return {
    presence:
      domain.presence === 'present'
        ? true
        : domain.presence === 'absent'
        ? false
        : null,

    observationCount: domain.raw.observationCount,
    nullSurface: domain.raw.nullSurface,
    firstSeenAt: domain.timestamps.firstSeenAt,
    lastSeenAt: domain.timestamps.lastSeenAt,
  };
}
