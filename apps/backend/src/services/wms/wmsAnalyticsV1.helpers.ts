// apps/backend/src/services/wms/wmsAnalyticsV1.helpers.ts
//
// GH-1231 — Analytics V1 pure helpers (no DB, no I/O).
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.3–§12B.5 (U1, U2).
//
//   - Product + variant display labels ("Default Title" never surfaces).
//   - Shop timezone validated as an IANA zone, UTC fallback.
//   - The V1 window is the last N shop-local calendar dates including today
//     (partial). It is NOT a rolling now − N×24h window, and it does not reuse
//     startOfShopDay(), which backtracks from the wall clock and is not
//     DST-correct.
//   - Every date boundary is the instant of local midnight on that date, so a
//     day can be 23h or 25h long.
//   - 7d / 30d: one bucket per date. 90d: Monday-start ISO weeks, the first
//     clipped by the window start, the last ending today (current, partial).
//   - Pace points are dense: a period with no activity is a real 0.
//
// Callers capture ONE request `now` (RED-2A clock ruling) and filter activity
// to [start_at, now]; a period's end_at is its calendar boundary, so the
// current period's end_at lies in the future.

const SUPPORTED_DAYS = [7, 30, 90] as const;
const DEFAULT_VARIANT_TITLE = 'Default Title';
const UNTITLED_VARIANT = 'Untitled variant';
const FALLBACK_TIMEZONE = 'UTC';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Canonical decimal integer as Postgres prints it: no sign, blank, hex, exponent or leading zero. */
const CANONICAL_INTEGER = /^(0|[1-9]\d*)$/;

export type AnalyticsWindowDays = (typeof SUPPORTED_DAYS)[number];
export type AnalyticsBucket = 'day' | 'week';

export type AnalyticsPeriod = {
  start_date: string;
  end_date: string;
  start_at: string;
  end_at: string;
  is_current: boolean;
  is_clipped: boolean;
};

export type AnalyticsWindow = {
  days: AnalyticsWindowDays;
  timezone: string;
  bucket: AnalyticsBucket;
  today_local: string;
  start_at: string;
  periods: AnalyticsPeriod[];
};

export type PacePoint = Pick<AnalyticsPeriod, 'start_date' | 'end_date' | 'is_current' | 'is_clipped'> & { items_picked: number };

export type PaceActivityRow = { local_date: string; items_picked: number | string };

// ─── Labels ──────────────────────────────────────────────────────────────────

/**
 * "Product - Variant", or the product alone when the variant title is empty or
 * "Default Title" (search.service variantLabel precedent). A lone variant title
 * is used only when it is meaningful; otherwise "Untitled variant".
 */
export function variantDisplayLabel(row: { product_title: string | null; variant_title: string | null }): string {
  const product = row.product_title?.trim() || '';
  const rawVariant = row.variant_title?.trim() || '';
  const variant = rawVariant === DEFAULT_VARIANT_TITLE ? '' : rawVariant;

  if (product && variant) return `${product} - ${variant}`;
  return product || variant || UNTITLED_VARIANT;
}

// ─── Timezone ────────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** The shop's IANA zone when valid; otherwise 'UTC' (null, empty, unknown or fixed-offset strings). */
export function resolveAnalyticsTimezone(timezone: string | null | undefined): string {
  const candidate = typeof timezone === 'string' ? timezone.trim() : '';
  // IANA names only — reject fixed offsets such as "+01:00" that newer ICU builds accept.
  if (!candidate || /^[+-]/.test(candidate)) return FALLBACK_TIMEZONE;
  try {
    dateFormatter(candidate);
    return candidate;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

// ─── Calendar dates ──────────────────────────────────────────────────────────

/** The calendar date (YYYY-MM-DD) of an instant in a zone. */
function localDateOf(instantMs: number, timezone: string): string {
  const parts = dateFormatter(timezone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A real calendar date: JS normalizes 2026-02-30 to March 2, so require an exact round-trip. */
function assertIsoDate(date: string): void {
  const ms = typeof date === 'string' && ISO_DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new TypeError(`Expected a YYYY-MM-DD calendar date, received ${JSON.stringify(date)}`);
  }
}

/** Pure calendar arithmetic on YYYY-MM-DD (timezone-free). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: Monday = 1 … Sunday = 7. */
function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

/**
 * The instant local midnight begins `date` in `timezone`: the earliest instant
 * whose local calendar date is `date`. Found by bisection over the ±15h span
 * that contains every real UTC offset, so it is exact across 23h/25h days and
 * also correct where a transition skips local midnight itself.
 */
export function localMidnightInstant(date: string, timezone: string): Date {
  assertIsoDate(date);
  const zone = resolveAnalyticsTimezone(timezone);
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let lo = utcMidnight - 15 * 3_600_000; // local date here is always before `date`
  let hi = utcMidnight + 15 * 3_600_000; // local date here is always `date` or later
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateOf(mid, zone) >= date) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

// ─── Window ──────────────────────────────────────────────────────────────────

function isSupportedDays(days: number): days is AnalyticsWindowDays {
  return (SUPPORTED_DAYS as readonly number[]).includes(days);
}

function period(startDate: string, endDate: string, timezone: string, flags: { is_current: boolean; is_clipped: boolean }): AnalyticsPeriod {
  return {
    start_date: startDate,
    end_date: endDate,
    start_at: localMidnightInstant(startDate, timezone).toISOString(),
    end_at: localMidnightInstant(addDays(endDate, 1), timezone).toISOString(),
    ...flags,
  };
}

/**
 * The V1 reporting window: the last `days` shop-local dates ending today.
 * 7/30 → one period per date; 90 → Monday-start weeks, the first clipped by
 * the window start when it does not begin on a Monday, the last ending today.
 */
export function buildAnalyticsWindow(input: { days: number; timezone: string | null | undefined; now: Date }): AnalyticsWindow {
  const { days } = input;
  if (!isSupportedDays(days)) {
    throw new RangeError(`Unsupported analytics window: ${days} (supported: ${SUPPORTED_DAYS.join(', ')})`);
  }
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('Analytics window requires a valid `now`');

  const timezone = resolveAnalyticsTimezone(input.timezone);
  const todayLocal = localDateOf(nowMs, timezone);
  const firstDate = addDays(todayLocal, -(days - 1));
  const bucket: AnalyticsBucket = days === 90 ? 'week' : 'day';

  const periods: AnalyticsPeriod[] = [];
  if (bucket === 'day') {
    for (let date = firstDate; date <= todayLocal; date = addDays(date, 1)) {
      periods.push(period(date, date, timezone, { is_current: date === todayLocal, is_clipped: false }));
    }
  } else {
    for (let start = firstDate; start <= todayLocal;) {
      const sunday = addDays(start, 7 - isoWeekday(start));
      const end = sunday < todayLocal ? sunday : todayLocal;
      periods.push(period(start, end, timezone, {
        is_current: end === todayLocal,
        is_clipped: start === firstDate && isoWeekday(start) !== 1,
      }));
      start = addDays(end, 1);
    }
  }

  return { days, timezone, bucket, today_local: todayLocal, start_at: periods[0].start_at, periods };
}

// ─── Pace ────────────────────────────────────────────────────────────────────

/**
 * A nonnegative safe-integer item count: a number, or a canonical decimal
 * string (Postgres SUM/COUNT text). Never coerces '', '  ', '0x10' or '1e2'.
 */
function itemCount(value: number | string): number {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && CANONICAL_INTEGER.test(value)) n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`Pace activity must be a nonnegative integer item count, received ${JSON.stringify(value)}`);
  }
  return n;
}

function addCount(sum: number, items: number): number {
  const next = sum + items;
  if (!Number.isSafeInteger(next)) throw new RangeError('Pace item total exceeds the safe integer range');
  return next;
}

/**
 * One point per window period (dense, in order). Each row is counted once, in
 * the period containing its shop-local date; rows outside the window's dates
 * are excluded. items_picked_total = Σ points. Invalid input fails loudly
 * rather than inventing or dropping values.
 */
export function densifyPacePoints(
  window: Pick<AnalyticsWindow, 'periods'>,
  rows: readonly PaceActivityRow[],
): { items_picked_total: number; points: PacePoint[] } {
  const points: PacePoint[] = window.periods.map((p) => ({
    start_date: p.start_date,
    end_date: p.end_date,
    items_picked: 0,
    is_current: p.is_current,
    is_clipped: p.is_clipped,
  }));

  for (const row of rows) {
    assertIsoDate(row.local_date);
    const items = itemCount(row.items_picked);
    const point = points.find((p) => p.start_date <= row.local_date && row.local_date <= p.end_date);
    if (point) point.items_picked = addCount(point.items_picked, items);
  }

  return { items_picked_total: points.reduce((sum, p) => addCount(sum, p.items_picked), 0), points };
}
