// apps/backend/src/services/products-ftep/ProductsFtep.types.ts

/**
 * Layer 2 — ProductsIntelligence (v2)
 *
 * Internal, deterministic classification derived from ProductsFacts.
 *
 * CRITICAL LAWS:
 * - Intelligence is computed ONLY when all required facts are present
 * - If ANY required fact is null, ALL intelligence MUST collapse to 'unknown'
 * - Intelligence NEVER escapes beyond FTEP
 *
 * Purpose:
 * - Enable internal downgrade logic
 * - Support FT2-safe exposure
 *
 * Non-goals:
 * - No explanations
 * - No recommendations
 * - No optimization logic
 */

export interface ProductsIntelligence {
 /**
   * Row-level product presence carried through from Facts.
   *
   * Semantics:
   * - Represents canonical row count (product × variant observations)
   * - May be null if no observable truth exists
   * - MUST NOT be reinterpreted or deduplicated here
   */
  productsObserved: number | null;


  /**
   * Outcome classification (internal only).
   *
   * Semantics:
   * - positive → ≥1 active product observed
   * - negative → 0 active AND ≥1 inactive or archived
   * - unknown  → missing facts or indeterminate state
   */
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  /**
   * Trend classification.
   *
   * Invariant:
   * - Always 'unknown' in FT2
   * - No historical comparison exists at this layer
   */
  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  /**
   * v2 internal signals (NEVER exposed directly).
   *
   * Rules:
   * - Derived only when facts are complete
   * - Used exclusively by FTEP for lossy downgrade
   * - MUST NOT be serialized or interpreted by UI
   */
    catalogHealth: 'healthy' | 'degraded' | 'unknown';
    skuCoverage: 'complete' | 'partial' | 'missing' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';

}

/**
 * Layer 3 — ProductsFTEP (Truth Exposure Policy) — v2
 *
 * FT2-safe exposure only.
 *
 * HARD RULES:
 * - No raw facts
 * - No intelligence internals
 * - No explanations
 * - No recommendations
 * - Signals must be lossy and non-semantic
 */
