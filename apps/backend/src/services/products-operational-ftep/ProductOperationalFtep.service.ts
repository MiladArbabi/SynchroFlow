import { ProductOperationalIntelligence } from '../products-operational-intelligence/ProductOperationalIntelligence.types.js';
import { ProductOperationalFT2Exposure } from './ProductOperationalFtep.types.js';

interface BuildProductOperationalFtepInput {
  intelligence: ProductOperationalIntelligence;
}

/**
 * buildProductOperationalFtep
 *
 * SECURITY ROLE:
 * - Downgrades internal operational intelligence
 * - Prevents semantic or causal leakage
 *
 * RULES:
 * - If any intelligence dimension is 'unknown' → exposure = null
 * - Labels are neutral, non-explanatory
 */
export function buildProductOperationalFtep(
  input: BuildProductOperationalFtepInput
): ProductOperationalFT2Exposure {
  const { intelligence } = input;

  const {
    inventoryCoverage,
    fulfillmentVisibility,
    operationalStability,
  } = intelligence;

  // ─────────────────────────────────────────
  // Unknown → total suppression
  // ─────────────────────────────────────────
  if (
    inventoryCoverage === 'unknown' ||
    fulfillmentVisibility === 'unknown' ||
    operationalStability === 'unknown'
  ) {
    return { operational: null };
  }

  return {
    operational: {
      inventory:
        inventoryCoverage === 'complete'
          ? 'ok'
          : inventoryCoverage === 'partial'
          ? 'gaps'
          : 'unknown',

      fulfillment:
        fulfillmentVisibility === 'present'
          ? 'visible'
          : fulfillmentVisibility === 'missing'
          ? 'missing'
          : 'unknown',

      stability:
        operationalStability === 'stable'
          ? 'stable'
          : operationalStability === 'fragile'
          ? 'fragile'
          : 'unknown',
    },
  };
}