// apps/backend/src/services/products-ftep/ProductsFtep.types.ts
import {
  ProductDataIntegrityFT2Exposure,
} from '../products-data-integrity-ftep/ProductDataIntegrityFtep.types';

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

export interface ProductsFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  /**
   * FT2-safe downgraded signals (v2)
   *
   * NOTE:
   * - These are NOT intelligence values
   * - They intentionally lose precision
   * - They must not imply causation or advice
   */
  signals: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * FT2-Paid Surface — Product Data Integrity
   * ─────────────────────────────────────────
   *
   * Null when:
   * - not entitled
   * - truth is unknown
   * - downgraded by policy
   */
  productDataIntegrity: ProductDataIntegrityFT2Exposure | null;
}
