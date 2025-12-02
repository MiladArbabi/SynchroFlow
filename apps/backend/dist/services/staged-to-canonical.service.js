"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAndPersistStagedEvent = mapAndPersistStagedEvent;
// apps/backend/src/services/staged-to-canonical.service.ts
const db_1 = __importDefault(require("../db"));
const transformer_1 = require("../transformer");
const mapping_rule_service_1 = require("api-src/services/mapping-rule.service");
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
async function mapAndPersistStagedEvent(stagedEvent) {
    if (!stagedEvent || !stagedEvent.raw_payload) {
        throw new Error('Invalid staged event');
    }
    // 1) Load mapping rules for this shop (may be mocked by tests)
    const mappingRules = await (0, mapping_rule_service_1.getMappingRulesForShop)(stagedEvent.shop_id);
    // 2) Transform raw payload into canonical shape
    const canonicalOrder = (0, transformer_1.transformPayload)(stagedEvent.raw_payload, mappingRules);
    // 3) Persist canonical order into 'orders' canonical table
    // Keep the insert shape generic — tests only assert that an insert + returning occurred.
    const inserted = await (0, db_1.default)('orders')
        .insert(canonicalOrder)
        .returning('*');
    return inserted;
}
exports.default = {
    mapAndPersistStagedEvent,
};
//# sourceMappingURL=staged-to-canonical.service.js.map