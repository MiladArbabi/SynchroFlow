// apps/backend/src/services/products-supply-intelligence/ProductSupplyIntelligence.types.ts

export interface ProductSupplyIntelligence {
  productsObserved: number | null;

  /**
   * Supply observability classifications
   *
   * Meaning:
   * - observable → signals exist for all observed products
   * - partial    → signals exist for some products
   * - missing    → no signals exist
   * - unknown    → facts unavailable
   */
  replenishmentVisibility: 'observable' | 'partial' | 'missing' | 'unknown';

  /**
   * Inventory + fulfillment combined coverage
   * (still presence-only, no timing or quantity)
   */
  supplySignalCoverage: 'complete' | 'partial' | 'missing' | 'unknown';
}