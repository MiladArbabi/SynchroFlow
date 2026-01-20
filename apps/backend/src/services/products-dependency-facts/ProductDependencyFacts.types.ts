// apps/backend/src/services/products-dependency-facts/ProductDependencyFacts.types.ts

export interface ProductDependencyFacts {
  shopId: number;
  period: {
    from: string;
    to: string;
  };

  /** Structural baseline */
  productsObserved: number | null;

  /** Presence by system surface */
  productsTouchingInventoryCount: number | null;
  productsTouchingSalesCount: number | null;
  productsTouchingFulfillmentCount: number | null;
  productsTouchingCostsCount: number | null;

  /** Coupling topology */
  systemsTouchedPerProductAvg: number | null;
  productsTouchingMultipleSystemsCount: number | null;

  extractedAt: string;
}