// apps/backend/src/services/order-nexus-ft2/orderNexusFt2.resolver.ts

import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { deriveOrderIntelligence } from 'api-src/services/order-intelligence/orderIntelligence.service';
import { exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';
import type { OrderFactsPeriod } from 'api-src/services/order-facts/orderFacts.types';
import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';

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
  period: OrderFactsPeriod;
}): Promise<OrderNexusFT2Exposure> {
  const { shopId, period } = input;

  const facts = await extractOrderFacts(shopId, period);
  const intelligence = deriveOrderIntelligence(facts);
  const exposure = exposeOrderNexusFT2({ facts, intelligence });

  return exposure;
}