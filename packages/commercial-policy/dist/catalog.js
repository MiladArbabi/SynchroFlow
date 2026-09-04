// @lasyncro/commercial-policy — the commercial capability CATALOG.
//
// One entry per capability the product has ever exposed, with an explicit
// lifecycle status. This is the seed for the future coverage snapshot (C24).
//
//   active   — a live, ratified commercial capability (see CAPABILITY_REQUIREMENTS)
//   legacy   — deprecated / paused product area, code kept for compatibility,
//              NOT an active paid capability (Finances / Cash Flow)
//   disabled — surface intentionally turned off for now
//
// Legacy/disabled entries carry NO AccessRequirement — they must never be
// evaluated as if they were live paid gates.
import { CAPABILITY_REQUIREMENTS } from './capabilities.js';
const ACTIVE_ENTRIES = Object.fromEntries(Object.keys(CAPABILITY_REQUIREMENTS).map((id) => [
    id,
    { status: 'active', requirement: CAPABILITY_REQUIREMENTS[id] },
]));
/**
 * Finances / Cash Flow — routes commented out in LifecycleRouteHost, module
 * kept in the legacy TIER_CONFIG for seeding compatibility. Explicitly NOT a
 * live commercial capability. (COMMERCIAL-ACCESS-ARCH-01 §11.)
 */
const LEGACY_ENTRIES = {
    'finances.core': { status: 'legacy', note: 'Finances surface paused; route disabled.' },
    'finances.cashflow': { status: 'legacy', note: 'Cash Flow surface paused; route disabled.' },
    'cashflow.revenue_buckets': { status: 'legacy', note: 'Legacy PLAN_FEATURES key; not an active gate.' },
    'customers.ltv': { status: 'disabled', note: 'Customers route commented out in LifecycleRouteHost.' },
};
export const CAPABILITY_CATALOG = Object.freeze({
    ...ACTIVE_ENTRIES,
    ...LEGACY_ENTRIES,
});
/** Back-compat alias. */
export const CATALOG = CAPABILITY_CATALOG;
export const LEGACY_CAPABILITIES = Object.freeze(Object.keys(CAPABILITY_CATALOG).filter((k) => CAPABILITY_CATALOG[k].status !== 'active'));
