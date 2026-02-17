/**
 * ⚠️ LEGACY SERVICE
 * ----------------
 * This service exists ONLY for:
 * - legacy mapping-rule based ingestion
 * - unit test scaffolding
 *
 * It is NOT part of:
 * - canonical ingestion
 * - FT0 / FT2 evaluation
 * - production worker flows
 *
 * Canonical ingestion bypasses this service entirely.
 */

import db from "@lasyncro/backend-core/db.js";
import { transformPayload } from "transformer.js";
import { getMappingRulesForShop } from "./mapping-rule.service.js";

// apps/backend/src/services/staged-to-canonical.service.ts

/**
 * Map a staged_event into canonical entities and persist them.
 * Minimal implementation to satisfy TDD red->green cycle for tests.
 *
 * - Loads mapping rules for the shop
 * - Runs the transformer to produce a canonical order shape
 * - Persists canonical order into "orders" table (returns inserted rows)
 *
 * This file intentionally keeps behavior simple and defensive: it
 * focuses on the single path exercised by the unit test.
 */
export async function mapAndPersistStagedEvent(stagedEvent: {
  id: number;
  shop_id: number;
  raw_payload: Record<string, any>;
}) {
  if (!stagedEvent || !stagedEvent.raw_payload) {
    throw new Error('Invalid staged event');
  }

  // 1) Load mapping rules for this shop (may be mocked by tests)
  const mappingRules = await getMappingRulesForShop(stagedEvent.shop_id);

  // 2) Transform raw payload into canonical shape
  const canonicalOrder = transformPayload(
    stagedEvent.raw_payload,
    mappingRules as any, // boundary between DB mapping rules and transformer contract
  );

  // 3) Persist canonical order into 'orders' canonical table
  // Keep the insert shape generic — tests only assert that an insert + returning occurred.
  const inserted = await db('orders')
    .insert(canonicalOrder)
    .returning('*');

  return inserted;
}

export default {
  mapAndPersistStagedEvent,
};
