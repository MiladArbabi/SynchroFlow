// apps/backend/src/services/products-data-freshness-facts/ProductDataFreshnessFacts.types.ts

export interface ProductDataFreshnessFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  structuralLastObservedAt: string | null;
  inventoryLastObservedAt: string | null;
  salesLastObservedAt: string | null;
  fulfillmentLastObservedAt: string | null;
  costLastObservedAt: string | null;

  extractedAt: string;
}