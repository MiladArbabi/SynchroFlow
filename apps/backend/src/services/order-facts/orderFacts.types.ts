/**
 * Order Facts — Canonical Truth Layer
 * ----------------------------------
 * These types represent raw, interpretation-free facts
 * extracted directly from persistence.
 *
 * Invariants:
 * - No statuses (healthy / unhealthy)
 * - No intelligence
 * - No explanations
 * - Nulls preserved exactly
 */

export interface OrderFactsPeriod {
  from: string;
  to: string;
}

/**
 * Canonical Order Facts
 * ---------------------
 * This is the ONLY type Layer 2 may consume.
 */
export interface OrderFacts {
  shopId: number;
  ordersObserved: number | null;

  ingestion: IngestionPresenceFact;

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  dataCoverage: {
    completenessPct: number | null;
  };

  freshness: {
    status: 'recent' | 'stale' | 'unknown';
  };

  extractedAt: string;
};

export interface IngestionPresenceFact {
  status: 'present' | 'absent';
}

/**
 * Backward-compatible alias
 * -------------------------
 * Snapshot = persisted representation of OrderFacts.
 * (Kept explicit to avoid semantic drift.)
 */
export type OrderFactsSnapshot = OrderFacts;