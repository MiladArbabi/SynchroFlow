// apps/frontend/src/pages/wms/analyticsV1Model.ts
//
// GH-1231 — Analytics V1 pure presentation model (no React, no HTTP).
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.4
// (Concept A + U1–U8). Merchant-facing meaning only:
//   - the five recorded Flow stages, including "Waiting to be packed";
//   - plain, cause-free problem labels; raw codes never shown;
//   - Team is alphabetical, never ranked by volume; "Showing K of N";
//   - recorded-status ages are uncapped; unknown is "—", never a zero;
//   - the current partial period reads "today so far" / "this week so far";
//   - Costs is setup-only (no money); the carrier cutoff shows only when valid;
//   - active-batch assignment is qualified, never "people working now".

// ─── Flow ────────────────────────────────────────────────────────────────────

/** The five live stages, in process order (order_warehouse_status values). */
export const FLOW_STAGES: readonly { status: 'awaiting_pick' | 'picking' | 'picked' | 'packing' | 'packed'; label: string }[] = [
  { status: 'awaiting_pick', label: 'Waiting to be picked' },
  { status: 'picking', label: 'Being picked' },
  { status: 'picked', label: 'Waiting to be packed' },
  { status: 'packing', label: 'Being packed' },
  { status: 'packed', label: 'Ready to ship' },
];

// ─── Problems ────────────────────────────────────────────────────────────────

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  short_pick: 'Could not pick full amount',
  item_missing: 'Item not found',
  wrong_item: 'Wrong item',
  product_defect: 'Damaged product',
  packaging_defect: 'Damaged packaging',
};

/** Factual description of a problem type; unknown codes never leak. */
export function problemTypeLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(PROBLEM_TYPE_LABELS, code) ? PROBLEM_TYPE_LABELS[code] : 'Other problem';
}

// ─── Team ────────────────────────────────────────────────────────────────────

/** Alphabetical, case-insensitive, user_id breaks ties; volume never reorders. Input is not mutated. */
export function sortTeamAlphabetically<T extends { user_id: number; display_name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => a.display_name.localeCompare(b.display_name, 'en', { sensitivity: 'base' }) || a.user_id - b.user_id,
  );
}

/** "Showing K of N" only when rows are clipped. */
export function teamOverflowLabel(shown: number, total: number): string | null {
  return shown < total ? `Showing ${shown} of ${total}` : null;
}

// ─── Ages and counts ─────────────────────────────────────────────────────────

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

const isKnown = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Elapsed time in the recorded status, uncapped. Unknown is "—", never a zero duration. */
export function formatStatusAge(seconds: number | null | undefined): string {
  if (!isKnown(seconds)) return '—';
  if (seconds < MINUTE) return 'Under 1 min';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min`;
  if (seconds < 2 * DAY) return `${Math.floor(seconds / HOUR)} h`;
  return `${Math.floor(seconds / DAY)} days`;
}

/** Ages of a day or more read "since an earlier day" (no severity colour). */
export function isEarlierDayAge(seconds: number | null | undefined): boolean {
  return isKnown(seconds) && seconds >= DAY;
}

const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A verified count ("0" is a real zero); unknown is "—". */
export function formatCount(value: number | null | undefined): string {
  return isKnown(value) ? COUNT_FORMAT.format(value) : '—';
}

// ─── Pace ────────────────────────────────────────────────────────────────────

/** The current, partial bucket of the selected window. */
export function partialPeriodLabel(bucket: 'day' | 'week'): string {
  return bucket === 'week' ? 'this week so far' : 'today so far';
}

// ─── Costs (U3) ──────────────────────────────────────────────────────────────

/** Setup-only strip: no money, no coverage figure, no unlock promise. */
export function costsStripCopy(unlocked: boolean): { text: string; href: string | null } {
  return unlocked
    ? { text: "Cost reporting isn't available in Analytics yet", href: null }
    : { text: 'Hourly rates are set in Team', href: '/team' };
}

// ─── Carrier cutoff (U4) ─────────────────────────────────────────────────────

const SHOP_CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/**
 * The configured cutoff on the shop clock ("HH:MM" or Postgres TIME
 * "HH:MM:SS") with the time remaining, or a statement that today's cutoff has
 * passed. Not configured or invalid → null. Never an on-track judgement.
 */
export function carrierCutoffCopy(cptLocal: string | null, hoursToCpt: number | null): string | null {
  const match = typeof cptLocal === 'string' ? SHOP_CLOCK_TIME.exec(cptLocal) : null;
  if (!match) return null;
  const time = `${match[1]}:${match[2]}`;
  if (hoursToCpt === null) return `Today's ${time} cutoff has passed`;
  if (!Number.isFinite(hoursToCpt) || hoursToCpt < 0) return null;
  const minutes = Math.round(hoursToCpt * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Carrier cutoff ${time} (shop time) · ${h > 0 ? `${h}h ${m}m` : `${m}m`} left`;
}

// ─── Assigned to active batches (safeguard) ──────────────────────────────────

/** live.active_operators: owners of in-progress batches — not people working right now. */
export function activeBatchAssignmentCopy(count: number | null | undefined): { label: string; value: string; qualification: string } {
  return {
    label: 'Assigned to active batches',
    value: formatCount(count),
    qualification: 'Includes unfinished batches — not a count of people working right now.',
  };
}
