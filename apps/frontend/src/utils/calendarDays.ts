// apps/frontend/src/utils/calendarDays.ts
//
// SRC-04 — calendar-day arithmetic.
//
// "Is this PO late?" is a question about DAYS, not elapsed hours. Subtracting a
// date from Date.now() answers a different question: it measures the interval
// to an instant, so a PO due today reads as -0.7 days at 17:00 and rounds to
// -1 — flagged overdue while still on time.
//
// Both operands here are UTC midnights of calendar days, so the subtraction is
// exact integer days with no rounding and no drift. "Today" is the viewer's
// local calendar day, projected into UTC purely as a comparison frame.
//
// SRC-05 will make the shop's configured timezone the source of "today" —
// that is a one-line change inside todayLocalYmd, which is why these live
// behind a helper rather than inline at each call site.

const MS_PER_DAY = 86_400_000;

/** The viewer's local calendar day as 'YYYY-MM-DD'. */
export function todayLocalYmd(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Whole calendar days from today until `ymd`. Negative = in the past.
 * Accepts 'YYYY-MM-DD' or any ISO string (the date part is used).
 * Returns null for null/empty input so callers can distinguish "no date set"
 * from "due today" — both would otherwise collapse to a falsy 0.
 */
export function daysUntilCalendarDay(ymd: string | null): number | null {
  if (!ymd) return null;
  const target = Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const today = Date.parse(`${todayLocalYmd()}T00:00:00Z`);
  return Math.round((target - today) / MS_PER_DAY);
}

/** True when `ymd` is strictly before today's calendar day. */
export function isPastCalendarDay(ymd: string | null): boolean {
  if (!ymd) return false;
  return ymd.slice(0, 10) < todayLocalYmd();
}
