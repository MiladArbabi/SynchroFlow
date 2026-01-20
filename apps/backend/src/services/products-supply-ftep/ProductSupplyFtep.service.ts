// apps/backend/src/services/products-supply-ftep/ProductSupplyFtep.service.ts

import { ProductSupplyIntelligence } from '../products-supply-intelligence/ProductSupplyIntelligence.types';
import { ProductSupplyFT2Exposure } from './ProductSupplyFtep.types';

/**
 * buildProductSupplyFtep
 *
 * Truth Exposure Policy for Supply & Replenishment Reality.
 *
 * SECURITY ROLE:
 * - Acts as the downgrade boundary
 * - Suppresses partial or unsafe truth
 *
 * HARD RULES:
 * - If ANY intelligence dimension is 'unknown' → exposure = null
 * - No raw facts
 * - No explanations
 * - No recommendations
 */
export function buildProductSupplyFtep(
  input: { intelligence: ProductSupplyIntelligence }
): ProductSupplyFT2Exposure {
  const { replenishmentVisibility, supplySignalCoverage } =
    input.intelligence;

  // ─────────────────────────────────────────
  // Unknown → total suppression
  // ─────────────────────────────────────────
  if (
    replenishmentVisibility === 'unknown' ||
    supplySignalCoverage === 'unknown'
  ) {
    return { supply: null };
  }

  return {
    supply: {
      replenishment:
        replenishmentVisibility === 'observable'
          ? 'observable'
          : replenishmentVisibility === 'missing'
          ? 'missing'
          : 'unknown',

      coverage: supplySignalCoverage,
    },
  };
}