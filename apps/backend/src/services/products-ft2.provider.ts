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
  const exposure = buildProductsFtep({ facts, intelligence });

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

  return {
    ...exposure,
    ...operationalExposure,
    productDataIntegrity,
    supply: supplyExposure.supply,
  };
}