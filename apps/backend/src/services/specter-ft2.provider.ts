//apps/backend/src/services/specter-ft2.provider.ts

import { getSpecterFacts } from "./specter-facts/specterFacts.service.js";
import { applySpecterFtep } from "./specter-ftep/specterFtep.service.js";
import { SpecterFT2Exposure } from "./specter-ftep/specterFtep.types.js";
import { deriveSpecterIntelligence } from "./specter-intelligence/specterIntelligence.service.js";

/**
 * Specter FT2 Provider
 * -------------------
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
export async function getSpecterFt2Snapshot(input: {
  shopId: number;
  period: { from: string; to: string };
  }): Promise<SpecterFT2Exposure> {
    /**
     * FT2 orchestration pipeline:
     * Facts → Intelligence → FTEP
     *
     * Note:
     * - multiStepSessionsPresent is derived in Facts
     * - Passed through FTEP as an FT2-safe structural signal
     * - No provider-level logic or filtering applied
     */
    const facts = await getSpecterFacts(input);
    const intelligence = deriveSpecterIntelligence(facts);
    const exposure = applySpecterFtep({ facts, intelligence });

    return exposure;
  }
