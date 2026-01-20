// apps/backend/src/services/products-data-freshness-intelligence/ProductDataFreshnessIntelligence.types.ts

export interface ProductDataFreshnessIntelligence {
  /**
   * NOTE:
   * - fresh   = at least one observable timestamp exists
   * - stale   = explicitly no timestamp observed
   * - unknown = facts unavailable
   *
   * This is PRESENCE classification only.
   * No time delta logic is allowed here.
   */
  structural: 'fresh' | 'stale' | 'unknown';
  inventory: 'fresh' | 'stale' | 'unknown';
  sales: 'fresh' | 'stale' | 'unknown';
  fulfillment: 'fresh' | 'stale' | 'unknown';
  cost: 'fresh' | 'stale' | 'unknown';
}