// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { deriveOrderIntelligence } from 'api-src/services/order-intelligence/orderIntelligence.service';
import { exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';
import { resolveAlignmentPlanes } from 'api-src/services/alignment-planes/alignmentPlanes.resolver';

/**
 * NOTE ON TREND WIRING
 * -------------------
 * Trend inputs are canonical facts (Layer 1½),
 * not analytical time-series.
 *
 * The resolver orchestrates:
 * - Facts
 * - Trend Facts
 * - Intelligence
 * - FTEP
 *
 * No analytical surfaces feed intelligence.
 */

import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';
import { FT2DateRangePreset } from 'api-src/utils/ft2Period';
import { extractOrderTrendFacts } from 'api-src/services/order-facts/orderTrendFacts.service';
import { extractOrderFulfillmentFacts } from '../order-facts/orderFulfillmentFacts.service';
import { deriveOrderFulfillmentIntelligence } from '../order-intelligence/orderFulfillmentIntelligence.service';

/**
 * OrderNexus FT2 Resolver
 * ----------------------
 * Orchestrates:
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - No lifecycle logic
 * - No business logic
 * - Deterministic for identical inputs
 */
export async function getOrderNexusFt2Snapshot(input: {
  shopId: number;
  range: FT2DateRangePreset | { preset: 'custom'; from: string; to: string },
}): Promise<OrderNexusFT2Exposure> {
  const { shopId, range } = input;

// Step 1: Extract canonical order facts (Layer 1)
const facts = await extractOrderFacts(shopId, range);

const trendFacts = await extractOrderTrendFacts(shopId, range);
const intelligence = deriveOrderIntelligence(facts, trendFacts);

// Step 4: Downgrade intelligence via FTEP
const exposure = exposeOrderNexusFT2({ facts, intelligence });

const fulfillmentFacts = await extractOrderFulfillmentFacts(shopId, range);
const fulfillmentIntelligence = deriveOrderFulfillmentIntelligence(
  fulfillmentFacts
);

// ─────────────────────────────────────────────
// Alignment Planes (META + Plane Inputs)
// ─────────────────────────────────────────────
const alignment = resolveAlignmentPlanes({
  meta: {
    visibilities: [
      intelligence.visibility.status === 'unknown'
        ? null
        : intelligence.visibility.status,

      fulfillmentIntelligence.visibility === 'unknown'
        ? null
        : fulfillmentIntelligence.visibility,
    ],
  },

  planes: [
    // Plane #1 — Demand Reality
    {
      planeId: 'demand-reality',
      input: {
        customers: {
          engagementTrend: null, // wired later from Specter
          visibility: null,
        },
        orders: {
          trend: intelligence.trend.direction,
          outcome: exposure.outcome?.status ?? null,
          visibility:
            intelligence.visibility.status === 'unknown'
              ? null
              : intelligence.visibility.status,
        },
      },
    },

    // Plane #3 — Operational ↔ Economic
    {
      planeId: 'operational-economic',
      input: {
        orders: {
          outcome: exposure.outcome?.status ?? null,
          visibility:
            intelligence.visibility.status === 'unknown'
              ? null
              : intelligence.visibility.status,
        },
        fulfillment: {
          operationalReality:
            fulfillmentIntelligence.operationalReality,
          visibility:
            fulfillmentIntelligence.visibility === 'unknown'
              ? null
              : fulfillmentIntelligence.visibility,
        },
      },
    },
  ],
});

  return {
    ...exposure,
    alignment: {
      demandReality: alignment['demand-reality'],
      operationalEconomic: alignment['operational-economic'],
    },
  };
}