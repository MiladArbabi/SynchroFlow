// @lasyncro/commercial-policy — the commercial capability CATALOG.
//
// One entry per capability the product has ever exposed, with an explicit
// lifecycle status. This is the seed for the future coverage snapshot (C24).
//
//   active     — a live, ratified commercial capability (see CAPABILITY_REQUIREMENTS)
//   paused     — product area withdrawn from sale but EXPECTED TO RETURN in a
//                future release; implementation deliberately retained (Finances)
//   deprecated — product area withdrawn and NOT expected to return; cleanup is a
//                separate future program (Customers, Specter)
//   legacy     — compatibility alias for the pre-remodel bucket, retained so
//                older readers/consumers do not break; prefer paused/deprecated
//   disabled   — surface intentionally turned off for now
//
// COMMERCIAL-REMODEL-ALIGN-01 (2026-09-06) split the old single `legacy` bucket
// into `paused` vs `deprecated`. That distinction is load-bearing: it is what
// says whether cleanup should ever be scheduled, and whether a surface may
// legitimately come back.
//
// Legacy/disabled entries carry NO AccessRequirement — they must never be
// evaluated as if they were live paid gates.

import type { CapabilityId } from './capabilities.js';
import { CAPABILITY_REQUIREMENTS } from './capabilities.js';
import type { AccessRequirement } from './access.js';

export type CapabilityStatus = 'active' | 'paused' | 'deprecated' | 'legacy' | 'disabled';

export interface CatalogEntry {
  status: CapabilityStatus;
  requirement?: AccessRequirement;
  note?: string;
}

const ACTIVE_ENTRIES = Object.fromEntries(
  (Object.keys(CAPABILITY_REQUIREMENTS) as CapabilityId[]).map((id) => [
    id,
    { status: 'active' as const, requirement: CAPABILITY_REQUIREMENTS[id] },
  ]),
) as Record<CapabilityId, CatalogEntry>;

/**
 * Non-active product areas. None of these carries an AccessRequirement — they
 * must never be evaluated as if they were a live paid gate, and they must never
 * appear in a standard tier module set (see modules.ts).
 *
 * PAUSED   — Finances / Cash Flow: routes commented out in LifecycleRouteHost,
 *            module kept in the legacy TIER_CONFIG for seeding compatibility.
 *            May return in a future release. (COMMERCIAL-ACCESS-ARCH-01 §11.)
 * DEPRECATED — Customers and Specter: not expected to return. Implementation is
 *            deliberately NOT deleted here; cleanup is a separate program.
 */
const NON_ACTIVE_ENTRIES: Record<string, CatalogEntry> = {
  'finances.core':            { status: 'paused', note: 'Finances surface paused; route disabled. May return.' },
  'finances.cashflow':        { status: 'paused', note: 'Cash Flow surface paused; route disabled. May return.' },
  'cashflow.revenue_buckets': { status: 'paused', note: 'Legacy PLAN_FEATURES key for a paused area; not an active gate.' },
  'customers.ltv':            { status: 'deprecated', note: 'Customers route commented out in LifecycleRouteHost; not expected to return.' },
  'customers.segmentation':   { status: 'deprecated', note: 'Legacy PLAN_FEATURES key; Customers is deprecated.' },
  // Specter had NO catalog entry before the remodel while
  // `specter.full_capture` was still a live capability — a deprecated area
  // carrying an active paid gate. Both halves are corrected here.
  'specter.full_capture':     { status: 'deprecated', note: 'Specter deprecated; retired as an active capability by COMMERCIAL-REMODEL-ALIGN-01.' },
};

/** Compatibility alias — the pre-remodel name for the non-active bucket. */
const LEGACY_ENTRIES = NON_ACTIVE_ENTRIES;

export const CAPABILITY_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  ...ACTIVE_ENTRIES,
  ...LEGACY_ENTRIES,
});

/** Back-compat alias. */
export const CATALOG = CAPABILITY_CATALOG;

export const LEGACY_CAPABILITIES: readonly string[] = Object.freeze(
  Object.keys(CAPABILITY_CATALOG).filter((k) => CAPABILITY_CATALOG[k].status !== 'active'),
);
