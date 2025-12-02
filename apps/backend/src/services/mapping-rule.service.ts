// apps/backend/src/services/mapping-rule.service.ts
// Minimal mapping-rule service used by tests and lightweight runtime behavior.
// Exports a single function `getMappingRulesForShop` which returns an array
// of mapping rules for a given shop. Tests can mock or override this module
// as needed; providing a real module here fixes module resolution errors.

export interface MappingRule {
  id?: number;
  shop_id?: number;
  source: string;
  target: string;
  options?: Record<string, any>;
}

export async function getMappingRulesForShop(shopId: number): Promise<MappingRule[]> {
  // Minimal default: no mapping rules. Tests should mock this when needed.
  return [];
}

export default {
  getMappingRulesForShop,
};
