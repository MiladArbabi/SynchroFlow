// apps/backend/src/services/products-ft2.provider.ts
import { getProductsFacts } from './products-facts';
import { buildProductsIntelligence } from './products-intelligence';
import { buildProductsFtep } from './products-ftep';
import { ProductsFT2Exposure } from './products-ftep/ProductsFtep.types';

import { getProductDataIntegritySnapshot } from './products-data-integrity.provider';

import { getProductOperationalFacts } from './products-operational-facts';
import { buildProductOperationalIntelligence } from './products-operational-intelligence';
import { buildProductOperationalFtep } from './products-operational-ftep';

import { getProductSupplyFacts } from './products-supply-facts';
import { buildProductSupplyIntelligence } from './products-supply-intelligence';
import { buildProductSupplyFtep } from './products-supply-ftep';

import { getProductDataFreshnessFacts } from './products-data-freshness-facts';
import { buildProductDataFreshnessIntelligence } from './products-data-freshness-intelligence';
import { buildProductDataFreshnessFtep } from './products-data-freshness-ftep';

import {
  buildProductCrossDomainAlignmentIntelligence,
  buildProductCrossDomainAlignmentFtep,
} from './products-cross-domain-alignment';
import { getProductCrossDomainAlignmentFacts } 
  from './products-cross-domain-alignment';

import { getProductDependencyFacts } from './products-dependency-facts';
import { buildProductDependencyIntelligence } from './products-dependency-intelligence';
import {buildProductDependencyFtep } from './products-dependency-ftep';

interface GetProductsFt2SnapshotInput {
  shopId: number;
  period: { from: string; to: string };

  /**
   * Entitlement resolution is passed in.
   * Provider never infers.
   */
  entitlements: {
    productDataIntegrity: {
      allowed: boolean;
    };
  };
}

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

  // ─────────────────────────────────────────
  // Core Products FT2
  // ─────────────────────────────────────────
  const facts = await getProductsFacts(input);
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
  });

  // ─────────────────────────────────────────
  // Operational Exposure (FT2-safe)
  // ─────────────────────────────────────────
  const operationalFacts = await getProductOperationalFacts({
    shopId,
    period,
  });

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
  });

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
  });

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
  });

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
  };
}