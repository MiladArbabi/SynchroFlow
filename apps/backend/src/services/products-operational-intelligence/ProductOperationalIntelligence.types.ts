/**
 * Layer 2 — ProductOperationalIntelligence
 *
 * Internal-only operational classification.
 *
 * RULES:
 * - Deterministic
 * - Derived strictly from ProductOperationalFacts
 * - Missing facts collapse to 'unknown'
 * - NEVER exposed directly
 */
export interface ProductOperationalIntelligence {
  productsObserved: number | null;

  inventoryCoverage: 'complete' | 'partial' | 'missing' | 'unknown';

  salesPresence: 'present' | 'absent' | 'unknown';

  fulfillmentVisibility: 'present' | 'missing' | 'unknown';

  operationalStability: 'stable' | 'fragile' | 'unknown';
}