import { ProductOperationalFacts } from '../products-operational-facts/ProductOperationalFacts.types.js';
import { ProductOperationalIntelligence } from './ProductOperationalIntelligence.types.js';

/**
 * buildProductOperationalIntelligence
 *
 * Converts operational facts → internal classifications.
 *
 * GUARANTEES:
 * - No persistence access
 * - No ratios exposed
 * - No recommendations
 * - Missing facts collapse to 'unknown'
 */
export function buildProductOperationalIntelligence(
  facts: ProductOperationalFacts
): ProductOperationalIntelligence {
  const {
    productsObserved,
    productsWithInventoryCount,
    productsWithoutInventoryCount,
    skusWithSalesCount,
    totalSkusObserved,
    ordersWithFulfillmentStatusCount,
  } = facts;

  const missing =
    productsObserved === null ||
    productsWithInventoryCount === null ||
    productsWithoutInventoryCount === null ||
    skusWithSalesCount === null ||
    totalSkusObserved === null ||
    ordersWithFulfillmentStatusCount === null;

  if (missing) {
    return {
      productsObserved,
      inventoryCoverage: 'unknown',
      salesPresence: 'unknown',
      fulfillmentVisibility: 'unknown',
      operationalStability: 'unknown',
    };
  }

  // ─────────────────────────────────────────
  // Inventory coverage
  // ─────────────────────────────────────────
  const inventoryCoverage =
    productsWithInventoryCount === 0
      ? 'missing'
      : productsWithoutInventoryCount === 0
      ? 'complete'
      : 'partial';

  // ─────────────────────────────────────────
  // Sales presence
  // ─────────────────────────────────────────
  const salesPresence =
    skusWithSalesCount > 0 ? 'present' : 'absent';

  // ─────────────────────────────────────────
  // Fulfillment visibility
  // ─────────────────────────────────────────
  const fulfillmentVisibility =
    ordersWithFulfillmentStatusCount > 0
      ? 'present'
      : 'missing';

  // ─────────────────────────────────────────
  // Operational stability (composed, still internal)
  // NOTE:
  // - This is NOT advice
  // - It is a deterministic roll-up signal
  // ─────────────────────────────────────────
  let operationalStability: ProductOperationalIntelligence['operationalStability'] =
    'stable';

  if (
    inventoryCoverage !== 'complete' ||
    fulfillmentVisibility !== 'present'
  ) {
    operationalStability = 'fragile';
  }

  return {
    productsObserved,
    inventoryCoverage,
    salesPresence,
    fulfillmentVisibility,
    operationalStability,
  };
}