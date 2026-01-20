// apps/backend/src/services/products-dependency-ftep/ProductDependencyFtep.types.ts

/**
 * Layer 3 — Dependency FT2 Exposure
 *
 * RULES:
 * - Lossy downgrade only
 * - No intelligence leakage
 * - Null = unknown or suppressed
 */
export interface ProductDependencyFT2Exposure {
  dependency: {
    surface: 'isolated' | 'coupled' | 'unknown';
    blastRadius: 'contained' | 'wide' | 'unknown';
  } | null;
}