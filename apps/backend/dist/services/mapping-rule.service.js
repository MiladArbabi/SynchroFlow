"use strict";
// apps/backend/src/services/mapping-rule.service.ts
// Minimal mapping-rule service used by tests and lightweight runtime behavior.
// Exports a single function `getMappingRulesForShop` which returns an array
// of mapping rules for a given shop. Tests can mock or override this module
// as needed; providing a real module here fixes module resolution errors.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMappingRulesForShop = getMappingRulesForShop;
async function getMappingRulesForShop(shopId) {
    // Minimal default: no mapping rules. Tests should mock this when needed.
    return [];
}
exports.default = {
    getMappingRulesForShop,
};
//# sourceMappingURL=mapping-rule.service.js.map