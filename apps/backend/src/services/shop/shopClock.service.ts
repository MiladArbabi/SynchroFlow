// apps/backend/src/services/shop/shopClock.service.ts
//
// SRC-05c — SHOP-LOCAL WALL CLOCK
//
// Several settings are stored as bare wall-clock values with no zone:
//   shop_operational_settings.daily_cpt_local   (time without time zone)
//   operator_schedules.start_time / end_time    (time without time zone)
//
// They mean "16:00 at the warehouse". Comparing them against server-local time
// answers a different question — on Fly the server is UTC, so a Stockholm
// warehouse's 16:00 cut-off was being evaluated two hours late, inflating
// hours_to_cpt and deflating required_uph.
//
// Intl is used rather than a date library: it carries the IANA database the
// zone strings come from, so DST is handled by definition rather than by an
// offset we would have to keep current.

/** The shop's current wall-clock parts, in its own timezone. */
export type ShopClock = {
  /** 0 = Sunday, matching Date#getDay and operator_schedules.weekday. */
  weekday: number;
  hour: number;
  minute: number;
  /** 'HH:MM', directly comparable to a stored time column. */
  hhmm: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Resolves `now` into the shop's local wall clock.
 * Falls back to UTC on an unknown zone rather than throwing — a bad timezone
 * string should degrade the countdown, not take down the analytics endpoint.
 */
export function getShopClock(timezone: string | null, now: Date = new Date()): ShopClock {
  const zone = timezone ?? 'UTC';

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    console.warn('[shopClock] unknown timezone, falling back to UTC', { timezone });
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  // hour12:false yields '24' rather than '00' at midnight in some runtimes.
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));

  return {
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    hour,
    minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * Hours from now until today's cut-off, in the shop's timezone.
 * Returns null when no cut-off is set or it has already passed today —
 * matching the prior contract, where null means "no countdown to show".
 */
export function hoursUntilCpt(
  cptLocal: string | null,
  timezone: string | null,
  now: Date = new Date(),
): number | null {
  if (!cptLocal) return null;

  const [h, m] = cptLocal.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    console.warn('[shopClock] unparseable daily_cpt_local', { cptLocal });
    return null;
  }

  const clock = getShopClock(timezone, now);
  const minutesUntil = (h * 60 + m) - (clock.hour * 60 + clock.minute);

  return minutesUntil > 0 ? minutesUntil / 60 : null;
}

/**
 * The UTC instant at which the shop's local day began.
 *
 * SRC-05c: `new Date(); setHours(0,0,0,0)` gives SERVER-local midnight. On a
 * UTC server that puts a Stockholm warehouse's "today" boundary at 02:00 local,
 * so anything shipped in the first two hours of the working day was counted
 * against yesterday.
 */
export function startOfShopDay(timezone: string | null, now: Date = new Date()): Date {
  const clock = getShopClock(timezone, now);
  // Rewind by however far into its local day the shop already is.
  const msIntoDay = (clock.hour * 60 + clock.minute) * 60_000;
  const start = new Date(now.getTime() - msIntoDay);
  // Zero the sub-minute remainder — getShopClock resolves only to minutes.
  start.setUTCSeconds(0, 0);
  return start;
}