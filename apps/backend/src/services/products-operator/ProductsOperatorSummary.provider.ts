// apps/backend/src/services/products-operator/ProductsOperatorSummary.provider.ts
import { getProductsOperatorFacts } from './ProductsOperatorFacts.service.js';
import { ProductsOperatorFacts } from './ProductsOperatorFacts.service.js';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { 
  getProductsDemandSignals, type ProductsDemandSignals
 } from './ProductsDemandBridge.service.js';
import {
  getProductsInboundSignals, type ProductsInboundSignals,
} from './ProductsInboundBridge.service.js';

/**
 * ProductsOperatorSummary
 * -----------------------
 * Purpose-built operator response contract.
 *
 * DESIGN CONTRACT:
 * - Operator language only — no technical jargon
 * - No FTEP constraints — this is a direct operator surface
 * - Null = data not available, not a policy decision
 */
export interface ProductsOperatorSummary {
  period: { from: string; to: string };

  // ── Sellability ───────────────────────────────────────────
  sellability: {
    sellable: number | null;
    blocked: number | null;
    blockedReasons: {
      noSku: number | null;
      noInventory: number | null;
      zeroStock: number | null;
    };
  };

  // ── Dead weight ───────────────────────────────────────────
  // Active products with no sales in the selected period
  deadWeight: {
    noSalesCount: number | null;
  };

  // ── Catalog drift ─────────────────────────────────────────
  drift: {
    addedThisPeriod: number | null;
  };

  // ── Top returned variants (all-time, top 5) ───────────────
  topReturned: Array<{
    variantTitle: string | null;
    sku: string | null;
    unitsReturned: number;
    revenueLeakage: number;
    returnRatePct: number;
  }>;

  // Products missing product code — grouped by product name
  // Operator needs to know exactly which products to fix
  noSkuProducts: Array<{
    productTitle: string | null;
    variants: Array<{ variantTitle: string | null }>;
  }>;
  // ── Demand signals (growth tier) ──────────────────────────
  // null = demand data unavailable (tier not enabled or no velocity yet)
  demand: ProductsDemandSignals | null;
  // ── Inbound PO pipeline ───────────────────────────────────
  // null = no open POs or suppliers module not yet used
  inbound: ProductsInboundSignals | null;
};

/**
 * getProductsOperatorSummary
 * --------------------------
 * Orchestrates operator facts into operator summary.
 *
 * Rules:
 * - No FTEP policy applied
 * - No intelligence downgrade
 * - Direct facts → response mapping
 */
export async function getProductsOperatorSummary(input: {
  shopId: number;
  period: { from: string; to: string };
}): Promise<ProductsOperatorSummary> {
  // Fetch facts + demand signals in parallel — demand owns its own RLS transaction
  const [facts, demand, inbound] = await Promise.all([
    withTenant(input.shopId, (trx) => getProductsOperatorFacts(input, trx)),
    getProductsDemandSignals(input.shopId),
    getProductsInboundSignals(input.shopId),
  ]);

  const blocked =
    (facts.noSkuCount ?? 0) +
    (facts.noInventoryCount ?? 0) +
    (facts.zeroStockCount ?? 0);

  return {
    period: facts.period,

    sellability: {
      sellable: facts.sellableCount,
      blocked: blocked > 0 ? blocked : 0,
      blockedReasons: {
        noSku: facts.noSkuCount,
        noInventory: facts.noInventoryCount,
        zeroStock: facts.zeroStockCount,
      },
    },

    deadWeight: {
      noSalesCount: facts.noSalesCount,
    },

    drift: {
      addedThisPeriod: facts.addedThisPeriodCount,
    },

    topReturned: facts.topReturned.map(r => ({
      variantTitle: r.variantTitle,
      sku: r.sku,
      unitsReturned: r.unitsReturned,
      revenueLeakage: r.revenueLeakage,
      returnRatePct: r.returnRatePct,
    })),

    noSkuProducts: facts.noSkuProducts,
    // null when growth tier not enabled or demand data not yet available
    demand,
    // null when no open POs or supplier module not yet used
    inbound,
  };
}