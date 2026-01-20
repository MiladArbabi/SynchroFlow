// apps/backend/src/services/products-supply-facts/ProductSupplyFacts.types.ts

export interface ProductSupplyFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * Canonical presence
   */
  productsObserved: number | null;

  /**
   * Supply-related signal presence
   */
  productsWithAnySupplySignalCount: number | null;
  productsWithInventorySignalCount: number | null;
  productsWithFulfillmentSignalCount: number | null;

  /**
   * Extraction timestamp (never exposed beyond FTEP)
   */
  extractedAt: string;
}