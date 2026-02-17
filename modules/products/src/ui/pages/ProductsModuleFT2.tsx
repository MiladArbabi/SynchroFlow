// modules/products/src/ui/pages/ProductsModuleFT2.tsx
import {
  FT2Layout,
  FT2Row,
} from '@lasyncro/ui-ft2';

import { ProductsOverviewInfoBlock } from '../components/ProductsOverviewInfoBlock.js';
import { ProductsOperationalInfoBlock } from '../components/ProductsOperationalInfoBlock.js';
import { ProductsSupplyInfoBlock } from '../components/ProductsSupplyInfoBlock.js';
import { ProductsDependencyInfoBlock } from '../components/ProductsDependencyInfoBlock.js';

import { ProductsAlignmentInfoBlock } from '../components/ProductsAlignmentInfoBlock.js';

/**
 * ProductsModuleFT2DataProps
 * --------------------------
 * DATA-ONLY FT2 contract.
 *
 * Rules:
 * - Observational facts only
 * - No inference, scoring, or recommendations
 * - Aggregated + time-series facts allowed
 * - Null = truth unavailable
 */
export interface ProductsModuleFT2DataProps {
  /** Global context */
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  /** High-level system status (downgraded) */
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  /** Directional trend (if available) */
  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  /**
   * FT2-Paid — Product Data Integrity
   *
   * Null when:
   * - truth is unknown
   * - downgraded by policy
   */
  productDataIntegrity: {
    integrity: 'ok' | 'attention' | 'unknown';
    duplication: 'present' | 'absent' | 'unknown';
  } | null;

/**
 * ─────────────────────────────────────────
 * Operational Exposure (FT2)
 * ─────────────────────────────────────────
 */
  operational: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * Supply & Replenishment Observability (FT2)
   * ─────────────────────────────────────────
   */
  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * Data Freshness & Trust Latency (FT2)
   * ─────────────────────────────────────────
   */
  dataFreshness: {
    structural: 'fresh' | 'stale' | 'unknown';
    inventory: 'fresh' | 'stale' | 'unknown';
    sales: 'fresh' | 'stale' | 'unknown';
    fulfillment: 'fresh' | 'stale' | 'unknown';
    cost: 'fresh' | 'stale' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * Cross-Domain Alignment (FT2)
   * ─────────────────────────────────────────
   */
  alignment: {
    alignment: 'aligned' | 'misaligned' | 'unknown';
  } | null;

/**
 * ─────────────────────────────────────────
 * Dependency Surface (FT2)
 * ─────────────────────────────────────────
 */
  dependency: {
    surface: 'isolated' | 'coupled' | 'unknown';
    blastRadius: 'contained' | 'wide' | 'unknown';
  } | null;

}

/**
 * ProductsModuleFT2Props
 * ----------------------
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals injected
 */
export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;

export default function ProductsModuleFT2(
  props: ProductsModuleFT2Props
) {
  
  const { 
    context, 
    outcome, 
    trend, 
    operational, 
    productDataIntegrity, 
    supply, 
    dependency, 
    alignment
  } = props;

  // FT2 structural snapshot
  const productsObserved = context.productsObserved;

  // Status breakdown not implemented in FT2 (intentional)
  const activeProducts: number | null = null;
  const inactiveOrArchivedProducts: number | null = null;

  return (
    <FT2Layout>
      <FT2Row intent="kpi">
      <ProductsOverviewInfoBlock
        productsObserved={productsObserved}
        activeProducts={activeProducts}
        inactiveOrArchivedProducts={inactiveOrArchivedProducts}
      />

      <ProductsOperationalInfoBlock
        inventory={operational?.inventory ?? null}
        fulfillment={operational?.fulfillment ?? null}
        stability={operational?.stability ?? null}
      />

      <ProductsSupplyInfoBlock
        replenishment={supply?.replenishment ?? null}
        coverage={supply?.coverage ?? null}
      />
      </FT2Row>

    <FT2Row intent="kpi">
      <ProductsDependencyInfoBlock
        surface={dependency?.surface ?? null}
        blastRadius={dependency?.blastRadius ?? null}
      />


      <ProductsAlignmentInfoBlock
        alignment={alignment?.alignment ?? null}
      />
    </FT2Row>
    </FT2Layout>
  );
}