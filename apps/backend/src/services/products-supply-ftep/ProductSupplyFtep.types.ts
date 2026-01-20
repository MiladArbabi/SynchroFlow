// apps/backend/src/services/products-supply-ftep/ProductSupplyFtep.types.ts

/**
 * Layer 3 — Supply FT2 Exposure
 *
 * RULES:
 * - Lossy downgrade only
 * - No intelligence leakage
 * - null = suppressed or unknowable truth
 */
export interface ProductSupplyFT2Exposure {
  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;
}