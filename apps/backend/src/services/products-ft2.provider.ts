// apps/backend/src/services/products-ft2.provider.ts
import { getProductsFacts } from './products-facts/index.js';
import { buildProductsIntelligence } from './products-intelligence/index.js';
import { buildProductsFtep } from './products-ftep/index.js';
import { ProductsFT2Exposure } from './products-ftep/ProductsFtep.types.js';

import { getProductDataIntegritySnapshot } from './products-data-integrity.provider.js';

import { getProductOperationalFacts } from './products-operational-facts/index.js';
import { buildProductOperationalIntelligence } from './products-operational-intelligence/index.js';
import { buildProductOperationalFtep } from './products-operational-ftep/index.js';

import { getProductSupplyFacts } from './products-supply-facts/index.js';
import { buildProductSupplyIntelligence } from './products-supply-intelligence/index.js';
import { buildProductSupplyFtep } from './products-supply-ftep/index.js';

import { getProductDataFreshnessFacts } from './products-data-freshness-facts/index.js';
import { buildProductDataFreshnessIntelligence } from './products-data-freshness-intelligence/index.js';
import { getProductCrossDomainAlignmentFacts } from './products-cross-domain-alignment/ProductCrossDomainAlignmentFacts.service.js';
import { buildProductCrossDomainAlignmentFtep } from './products-cross-domain-alignment/ProductCrossDomainAlignmentFtep.service.js';
import { buildProductCrossDomainAlignmentIntelligence } from './products-cross-domain-alignment/ProductCrossDomainAlignmentIntelligence.service.js';
import { buildProductDataFreshnessFtep } from './products-data-freshness-ftep/ProductDataFreshnessFtep.service.js';
import { getProductDependencyFacts } from './products-dependency-facts/ProductDependencyFacts.service.js';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { buildProductDependencyFtep } from './products-dependency-ftep/ProductDependencyFtep.service.js';
import { buildProductDependencyIntelligence } from './products-dependency-intelligence/ProductDependencyIntelligence.service.js';

/**
 * Products FT2 Provider
 * --------------------
 * Orchestrates the FT2 pipeline:
 *
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - No lifecycle decisions
 * - No persistence beyond Facts
 * - No intelligence leakage
 * - Deterministic for identical inputs
 */
export async function getProductsFt2Snapshot(
  input: {
    shopId: number;
    period: { from: string; to: string };
  }
): Promise<
  ProductsFT2Exposure & {
    operational: {
      inventory: 'ok' | 'gaps' | 'unknown';
      fulfillment: 'visible' | 'missing' | 'unknown';
      stability: 'stable' | 'fragile' | 'unknown';
    } | null;

    /**
     * Supply & Replenishment (FT2)
     * Suppressed by default unless FTEP allows exposure
     */
    supply: {
      replenishment: 'observable' | 'missing' | 'unknown';
      coverage: 'complete' | 'partial' | 'missing' | 'unknown';
    } | null;
  }
> {
  const { shopId, period } = input;
  return withTenant(shopId, async (trx) => {
  // ─────────────────────────────────────────
  // Core Products FT2
  // ─────────────────────────────────────────
  const facts = await getProductsFacts(input, trx);
  const intelligence = buildProductsIntelligence(facts);
  const exposureBase = buildProductsFtep({
    facts,
    intelligence,
    alignment: null,
  });

  // ─────────────────────────────────────────
  // FT2-Paid — Product Data Integrity
  // ─────────────────────────────────────────
  const productDataIntegrity =
  await getProductDataIntegritySnapshot({
    shopId,
    period,
  }, trx);

  // ─────────────────────────────────────────
  // Operational Exposure (FT2-safe)
  // ─────────────────────────────────────────
  const operationalFacts = await getProductOperationalFacts({
    shopId,
    period,
  }, trx);

  const operationalIntelligence =
    buildProductOperationalIntelligence(operationalFacts);

  const operationalExposure =
    buildProductOperationalFtep({
      intelligence: operationalIntelligence,
    });

  // ─────────────────────────────────────────
  // Supply & Replenishment Reality (FT2-safe)
  // ─────────────────────────────────────────
  const supplyFacts = await getProductSupplyFacts({
    shopId,
    period,
  }, trx);

  const supplyIntelligence =
    buildProductSupplyIntelligence(supplyFacts);

  const supplyExposure =
    buildProductSupplyFtep({
      intelligence: supplyIntelligence,
    });

  // ─────────────────────────────────────────
  // Data Freshness & Trust Latency (FT2-safe)
  // ─────────────────────────────────────────
  const freshnessFacts = await getProductDataFreshnessFacts({
    shopId,
    period,
  }, trx);

  const freshnessIntelligence =
    buildProductDataFreshnessIntelligence(freshnessFacts);

  const freshnessExposure =
    buildProductDataFreshnessFtep({
      intelligence: freshnessIntelligence,
    });

  const alignmentFacts = getProductCrossDomainAlignmentFacts({
    shopId,
    period,

    structuralProductsObserved: facts.productsObserved,
    operationalProductsObserved: operationalFacts.productsObserved,
    supplyProductsObserved: supplyFacts.productsObserved,

    freshnessObserved: freshnessExposure.freshness
      ? {
          structural: freshnessExposure.freshness.structural,
          inventory: freshnessExposure.freshness.inventory,
          sales: freshnessExposure.freshness.sales,
          fulfillment: freshnessExposure.freshness.fulfillment,
          cost: freshnessExposure.freshness.cost,
        }
      : null,
  });

  // ─────────────────────────────────────────
  // Cross-Domain Alignment (FT2-safe)
  // ─────────────────────────────────────────
  const freshnessForAlignment =
    freshnessExposure.freshness &&
    Object.values(freshnessExposure.freshness).every(v => v !== null)
      ? {
          structural: freshnessExposure.freshness.structural!,
          inventory: freshnessExposure.freshness.inventory!,
          sales: freshnessExposure.freshness.sales!,
          fulfillment: freshnessExposure.freshness.fulfillment!,
          cost: freshnessExposure.freshness.cost!,
        }
      : null;

const alignmentIntelligence =
  buildProductCrossDomainAlignmentIntelligence({
    alignmentEvidencePresent:
      alignmentFacts?.alignmentEvidencePresent ?? null,
    supply: supplyExposure?.supply ?? null,
    operational: operationalExposure?.operational ?? null,
    freshness: freshnessForAlignment,
  });

  const alignmentExposure =
    buildProductCrossDomainAlignmentFtep({
      facts: alignmentFacts,
      intelligence: alignmentIntelligence,
    });

  // ─────────────────────────────────────────
  // Dependency — Facts → Intelligence → FTEP
  // ─────────────────────────────────────────
  const dependencyFacts = await getProductDependencyFacts({
    shopId,
    period,
  }, trx);

  const dependencyIntelligence =
    buildProductDependencyIntelligence(dependencyFacts);

  const dependency =
    buildProductDependencyFtep(dependencyIntelligence);


  return {
    ...exposureBase,
    alignment: alignmentExposure
      ? { alignment: alignmentExposure.alignment }
      : null,
    productDataIntegrity,
    operational: operationalExposure.operational ?? null,
    supply: supplyExposure.supply ?? null,
    dataFreshness: freshnessExposure.freshness ?? null,
    dependency: dependency.dependency ?? null,

    // Operational counts — raw presence-based facts, no inference
    // Source: ProductOperationalFacts (getProductOperationalFacts)
    operationalCounts: operationalFacts.productsObserved !== null
      ? {
          productsWithInventoryCount: operationalFacts.productsWithInventoryCount,
          productsWithoutInventoryCount: operationalFacts.productsWithoutInventoryCount,
          skusWithSalesCount: operationalFacts.skusWithSalesCount,
          totalSkusObserved: operationalFacts.totalSkusObserved,
        }
      : null,

    // Supply counts — presence-based facts, no inference
    // Source: ProductSupplyFacts (getProductSupplyFacts)
    supplyCounts: supplyFacts.productsObserved !== null
      ? {
          productsWithInventorySignalCount: supplyFacts.productsWithInventorySignalCount,
        }
      : null,
    };
  });
}