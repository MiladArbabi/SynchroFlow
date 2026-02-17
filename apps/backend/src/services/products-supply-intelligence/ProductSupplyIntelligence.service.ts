// apps/backend/src/services/products-supply-intelligence/ProductSupplyIntelligence.service.ts

import { ProductSupplyFacts } from "../../services/products-supply-facts/ProductSupplyFacts.types.js";
import { ProductSupplyIntelligence } from "./ProductSupplyIntelligence.types.js";

/**
 * buildProductSupplyIntelligence
 *
 * Converts supply signal facts → internal observability classifications.
 *
 * GUARANTEES:
 * - No DB access
 * - No ratios
 * - No thresholds
 * - No optimization logic
 * - Missing facts collapse to 'unknown'
 */
export function buildProductSupplyIntelligence(
  facts: ProductSupplyFacts
): ProductSupplyIntelligence {
  const {
    productsObserved,
    productsWithAnySupplySignalCount,
    productsWithInventorySignalCount,
    productsWithFulfillmentSignalCount,
  } = facts;

  const missing =
    productsObserved === null ||
    productsWithAnySupplySignalCount === null ||
    productsWithInventorySignalCount === null ||
    productsWithFulfillmentSignalCount === null;

  if (missing) {
    return {
      productsObserved,
      replenishmentVisibility: 'unknown',
      supplySignalCoverage: 'unknown',
    };
  }

  // ─────────────────────────────────────────
  // Replenishment visibility (any signal)
  // ─────────────────────────────────────────
  let replenishmentVisibility: ProductSupplyIntelligence['replenishmentVisibility'];

  if (productsWithAnySupplySignalCount === 0) {
    replenishmentVisibility = 'missing';
  } else if (
    productsWithAnySupplySignalCount < productsObserved
  ) {
    replenishmentVisibility = 'partial';
  } else {
    replenishmentVisibility = 'observable';
  }

  // ─────────────────────────────────────────
  // Supply signal coverage (inventory + fulfillment)
  // ─────────────────────────────────────────
  const inventoryPresent =
    productsWithInventorySignalCount > 0;
  const fulfillmentPresent =
    productsWithFulfillmentSignalCount > 0;

  let supplySignalCoverage: ProductSupplyIntelligence['supplySignalCoverage'];

  if (!inventoryPresent && !fulfillmentPresent) {
    supplySignalCoverage = 'missing';
  } else if (inventoryPresent && fulfillmentPresent) {
    supplySignalCoverage = 'complete';
  } else {
    supplySignalCoverage = 'partial';
  }

  return {
    productsObserved,
    replenishmentVisibility,
    supplySignalCoverage,
  };
}