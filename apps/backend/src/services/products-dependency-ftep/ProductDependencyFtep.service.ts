// apps/backend/src/services/products-dependency-ftep/ProductDependencyFtep.service.ts

import { ProductDependencyIntelligence } from '../products-dependency-intelligence/ProductDependencyIntelligence.types';
import { ProductDependencyFT2Exposure } from './ProductDependencyFtep.types';

/**
 * buildProductDependencyFtep
 *
 * SECURITY ROLE:
 * - Final downgrade boundary before FT2 exposure
 * - Prevents semantic or numeric leakage
 *
 * RULES:
 * - If any intelligence field is 'unknown' → exposure = null
 * - Labels must be lossy and non-explanatory
 */
export function buildProductDependencyFtep(
  intelligence: ProductDependencyIntelligence
): ProductDependencyFT2Exposure {
  const { dependencySurface, blastRadius } = intelligence;

  // ─────────────────────────────────────────
  // Total suppression on unknown
  // ─────────────────────────────────────────
  if (
    dependencySurface === 'unknown' ||
    blastRadius === 'unknown'
  ) {
    return { dependency: null };
  }

  return {
    dependency: {
      surface: dependencySurface,
      blastRadius,
    },
  };
}