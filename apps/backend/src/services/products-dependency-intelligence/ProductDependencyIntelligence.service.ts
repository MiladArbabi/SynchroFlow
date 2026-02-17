// apps/backend/src/services/products-dependency-intelligence/ProductDependencyIntelligence.service.ts

import { ProductDependencyFacts } from '../products-dependency-facts/ProductDependencyFacts.types.js';
import { ProductDependencyIntelligence } from './ProductDependencyIntelligence.types.js';

/**
 * buildProductDependencyIntelligence
 *
 * Layer 2 (Intelligence) — Dependency.
 *
 * RULES:
 * - Presence-only classification
 * - No ratios exposed
 * - Missing facts collapse to 'unknown'
 */
export function buildProductDependencyIntelligence(
  facts: ProductDependencyFacts
): ProductDependencyIntelligence {
  const {
    productsObserved,
    productsTouchingMultipleSystemsCount,
    systemsTouchedPerProductAvg,
  } = facts;

  // ─────────────────────────────────────────
  // Hard null collapse
  // ─────────────────────────────────────────
  if (
    productsObserved === null ||
    productsTouchingMultipleSystemsCount === null ||
    systemsTouchedPerProductAvg === null
  ) {
    return {
      dependencySurface: 'unknown',
      blastRadius: 'unknown',
    };
  }

  // ─────────────────────────────────────────
  // Dependency surface (binary, structural)
  // ─────────────────────────────────────────
  const dependencySurface =
    systemsTouchedPerProductAvg > 1
      ? 'coupled'
      : 'isolated';

  // ─────────────────────────────────────────
  // Blast radius (presence-only)
  // NOTE:
  // - No percentages exposed
  // - Uses absolute presence comparison only
  // ─────────────────────────────────────────
  const blastRadius =
    productsTouchingMultipleSystemsCount > 0
      ? 'wide'
      : 'contained';

  return {
    dependencySurface,
    blastRadius,
  };
}