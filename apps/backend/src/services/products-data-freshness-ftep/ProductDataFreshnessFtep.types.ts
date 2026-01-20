// apps/backend/src/services/products-data-freshness-ftep/ProductDataFreshnessFtep.types.ts

/**
 * Layer 3 — Data Freshness FT2 Exposure
 *
 * RULES:
 * - Per-domain exposure
 * - Lossy, non-semantic labels
 * - null = intentionally suppressed or unknowable
 */
export interface ProductDataFreshnessFT2Exposure {
  freshness: {
    structural: 'fresh' | 'stale' | 'unknown' | null;
    inventory: 'fresh' | 'stale' | 'unknown' | null;
    sales: 'fresh' | 'stale' | 'unknown' | null;
    fulfillment: 'fresh' | 'stale' | 'unknown' | null;
    cost: 'fresh' | 'stale' | 'unknown' | null;
  } | null;
}