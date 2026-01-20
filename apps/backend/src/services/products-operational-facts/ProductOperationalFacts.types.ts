/**
 * Layer 1 — ProductOperationalFacts
 *
 * Raw, interpretation-free operational observability facts.
 *
 * INVARIANTS:
 * - Existence-only (no sufficiency, no correctness)
 * - No inference or ratios
 * - Period applied ONLY where schema allows
 * - null ≠ 0
 */
export interface ProductOperationalFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /** Canonical product surface */
  productsObserved: number | null;

  /** Inventory observability (snapshot) */
  productsWithInventoryCount: number | null;
  productsWithoutInventoryCount: number | null;

  /** Sales observability (time-scoped, SKU-based) */
  skusWithSalesCount: number | null;
  totalSkusObserved: number | null;

  /** Fulfillment observability (order-level, current) */
  ordersWithFulfillmentStatusCount: number | null;
  ordersWithoutFulfillmentStatusCount: number | null;

  /** Extraction timestamp (never exposed beyond FTEP) */
  extractedAt: string;
}