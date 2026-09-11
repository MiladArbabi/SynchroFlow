// apps/backend/src/services/inventory/stockProtectionPolicyResolution.ts
//
// STOCK-PROTECT-01 — pure effective-policy resolution rule.
// ============================================================================
// Given the persisted CURRENT authoritative row for a shop+variant (or null,
// meaning no approved policy exists), returns the effective planning inputs.
//
// This function is deliberately pure: no DB, no network, no clock. It never
// accepts, and never returns, derived intelligence (velocity, current stock,
// buffer units, reorder point, stockout date, suggested reorder qty,
// urgency) — that is computed at read time by demandIntelligence.service.ts
// and is not policy authority.
//
// NO_POLICY LEGACY DEFAULT — preserves the effective behaviour that was
// previously hardcoded in demandIntelligence.service.ts as SYSTEM_SAFETY_DAYS
// (5) and SYSTEM_PURCHASING_CYCLE_DAYS (7), before any merchant configuration
// existed.

export interface CurrentPolicyRow {
  version: number;
  safety_days: number;
  review_cycle_days: number;
  planning_supplier_id: number | null;
  source?: string;
  approved_by_actor_type?: string;
  approved_by_actor_id?: string | null;
  approved_at?: Date | string;
}

export interface EffectivePolicy {
  safety_days: number;
  review_cycle_days: number;
  planning_supplier_id: number | null;
  source: 'merchant_approved' | 'system_default';
  version: number | null;
}

const NO_POLICY_SAFETY_DAYS = 5;
const NO_POLICY_REVIEW_CYCLE_DAYS = 7;

export function resolveEffectivePolicy(current: CurrentPolicyRow | null): EffectivePolicy {
  if (current === null) {
    return {
      safety_days: NO_POLICY_SAFETY_DAYS,
      review_cycle_days: NO_POLICY_REVIEW_CYCLE_DAYS,
      planning_supplier_id: null,
      source: 'system_default',
      version: null,
    };
  }

  return {
    safety_days: current.safety_days,
    review_cycle_days: current.review_cycle_days,
    planning_supplier_id: current.planning_supplier_id,
    source: 'merchant_approved',
    version: current.version,
  };
}
