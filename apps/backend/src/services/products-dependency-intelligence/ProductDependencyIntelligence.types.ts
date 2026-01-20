// apps/backend/src/services/products-dependency-intelligence/ProductDependencyIntelligence.types.ts

export interface ProductDependencyIntelligence {
  /**
   * Coupling surface classification
   *
   * isolated  → touches 0–1 systems
   * coupled   → touches multiple systems
   * unknown   → insufficient facts
   */
  dependencySurface: 'isolated' | 'coupled' | 'unknown';

  /**
   * Blast radius observability
   *
   * contained → few products span multiple systems
   * wide      → many products span multiple systems
   * unknown   → insufficient facts
   */
  blastRadius: 'contained' | 'wide' | 'unknown';
}