// apps/backend/src/services/analytics-intelligence/analyticsIntelligence.service.ts
import { AnalyticsFacts } from '../analytics-facts/analyticsFacts.types';
import {
  AnalyticsIntelligence,
  AnalyticsDomainIntelligence,
} from './analyticsIntelligence.types';

/**
 * buildAnalyticsIntelligence
 *
 * Layer 2 — Observability Intelligence
 *
 * Converts raw AnalyticsFacts into structured observability states.
 *
 * CRITICAL RULES:
 * - No DB access
 * - No performance meaning
 * - No optimization logic
 * - No collapsing of ambiguity
 * - When unsure → 'unknown'
 */
export function buildAnalyticsIntelligence(
  facts: AnalyticsFacts
): AnalyticsIntelligence {
  // Helper to build domain intelligence uniformly
  function buildDomainIntelligence(
    domain: {
      presence: boolean | null;
      observationCount: number | null;
      nullSurface: number | null;
      firstSeenAt: string | null;
      lastSeenAt: string | null;
    }
  ): AnalyticsDomainIntelligence {
    return {
      presence: classifyPresence(domain.presence),
      observationLevel: classifyObservationLevel(
        domain.observationCount
      ),
      continuity: classifyContinuity(
        domain.firstSeenAt,
        domain.lastSeenAt,
        domain.presence
      ),
      timestamps: {
        firstSeenAt: domain.firstSeenAt,
        lastSeenAt: domain.lastSeenAt,
      },
      raw: {
        observationCount: domain.observationCount,
        nullSurface: domain.nullSurface,
      },
    };
  }

  return {
    snapshot: {
      id: facts.snapshotId,
      extractedAt: facts.extractedAt,
    },
    domains: {
      // Signal #1 — Orders
      orders: buildDomainIntelligence(facts.domains.orders),

      // Signal #2 — Products
      products: buildDomainIntelligence(facts.domains.products),

      // Signal #3 — Customers
      customers: buildDomainIntelligence(facts.domains.customers),

      // Signal #4 — Finances (presence-only still maps cleanly)
      finances: buildDomainIntelligence(facts.domains.finances),
    },
  };
}

/**
 * classifyPresence
 *
 * Presence is about existence, not success.
 */
function classifyPresence(
  presence: boolean | null
): 'present' | 'absent' | 'unknown' {
  if (presence === null) return 'unknown';
  return presence ? 'present' : 'absent';
}

/**
 * classifyObservationLevel
 *
 * Pure volume-based classification.
 * No business meaning implied.
 */
function classifyObservationLevel(
  count: number | null
): 'none' | 'low' | 'partial' | 'full' | 'unknown' {
  if (count === null) return 'unknown';
  if (count === 0) return 'none';
  if (count < 10) return 'low';
  if (count < 100) return 'partial';
  return 'full';
}

/**
 * classifyContinuity
 *
 * Continuity describes whether observability spans the window.
 * NOT a trend. NOT performance.
 */

/**
 * Continuity classification
 *
 * IMPORTANT:
 * - Requires Analytics-owned timestamps
 * - FT2-sourced domains will always return 'unknown'
 * - Absence of time ≠ intermittent observability
 */

function classifyContinuity(
  firstSeenAt: string | null,
  lastSeenAt: string | null,
  presence: boolean | null
): 'continuous' | 'intermittent' | 'missing' | 'unknown' {
  // Analytics does NOT own time for FT2-sourced domains.
  // Without timestamps, continuity is unknowable.
  if (!firstSeenAt || !lastSeenAt) {
    return 'unknown';
  }

  if (presence === null) return 'unknown';
  if (!presence) return 'missing';

  return 'continuous';
}