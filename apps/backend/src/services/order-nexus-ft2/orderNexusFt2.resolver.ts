// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts
import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { deriveOrderIntelligence } from 'api-src/services/order-intelligence/orderIntelligence.service';
import { exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';

/**
 * NOTE ON TIME-SERIES WIRING
 * -------------------------
 * Trend direction is an INTERNAL intelligence signal.
 *
 * To preserve layer boundaries:
 * - Time-series data is fetched here (resolver level)
 * - Layer 2 receives it as an explicit input
 * - Layer 2 does NOT read from the database
 *
 * This keeps:
 * - Facts pure
 * - Intelligence deterministic
 * - FTEP leak-safe
 */
import { getOrderNexusFt2Timeseries } from './orderNexusFt2.timeseries';

import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';
import { FT2DateRangePreset } from 'api-src/utils/ft2Period';

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

// Step 2: Fetch FT2 time-series (analytical surface, DB-direct)
const { series } = await getOrderNexusFt2Timeseries({
  shopId,
  range,
});

// Step 3: Derive internal intelligence using facts + time-series
const intelligence = deriveOrderIntelligence(facts, series);

// Step 4: Downgrade intelligence via FTEP
const exposure = exposeOrderNexusFT2({ facts, intelligence });

  return exposure;
}