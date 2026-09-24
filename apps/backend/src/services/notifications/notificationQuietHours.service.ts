import { getShopClock } from '../shop/shopClock.service.js';
import type { NotificationPreferences } from './notificationPreferences.js';

type QuietHours = NotificationPreferences['quiet_hours'];

export type QuietHoursDecision =
  | { executable: true }
  | { executable: false; nextAttemptAt: Date };

const MINUTE_MS = 60_000;
const MAX_QUIET_SCAN_MINUTES = 30 * 60;

function parseHHMM(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function isInsideQuietHours(
  clockMinutes: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return false;
  if (start < end) return clockMinutes >= start && clockMinutes < end;
  return clockMinutes >= start || clockMinutes < end;
}

/**
 * Keep Alerts aligned with the canonical shop-clock failure contract:
 * malformed/unknown IANA zones degrade to UTC rather than breaking the
 * notification worker.
 */
function resolveTimezone(timezone: string | null): string {
  const zone = timezone ?? 'UTC';

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    console.warn(
      '[notificationQuietHours] unknown timezone, falling back to UTC',
      { timezone },
    );
    return 'UTC';
  }
}

/**
 * Find the first real UTC minute after `now` whose shop-local wall clock is
 * outside the configured quiet interval.
 *
 * We intentionally scan forward in real UTC time instead of reverse-mapping
 * a local wall time to UTC. Reverse mapping is ambiguous during the DST
 * repeated hour and impossible during the DST skipped hour.
 *
 * A 30-hour ceiling safely spans a full local day plus DST transitions while
 * still failing loudly if corrupted settings somehow violate the contract.
 */
export function firstEligibleInstantAfterQuietHours(params: {
  timezone: string | null;
  now: Date;
  quietHours: QuietHours;
}): Date {
  const start = parseHHMM(params.quietHours.start);
  const end = parseHHMM(params.quietHours.end);
  const zone = resolveTimezone(params.timezone);

  const cursor = new Date(params.now.getTime());
  cursor.setUTCSeconds(0, 0);

  // Must always move strictly forward from `now`, including when now is
  // exactly on a minute boundary.
  cursor.setTime(cursor.getTime() + MINUTE_MS);

  for (let index = 0; index < MAX_QUIET_SCAN_MINUTES; index += 1) {
    const clock = getShopClock(zone, cursor);
    const current = clock.hour * 60 + clock.minute;

    if (!isInsideQuietHours(current, start, end)) {
      return new Date(cursor.getTime());
    }

    cursor.setTime(cursor.getTime() + MINUTE_MS);
  }

  throw new Error(
    'NOTIFICATION_QUIET_HOURS_NEXT_ELIGIBLE_NOT_FOUND',
  );
}

export function resolveQuietHoursDecision(params: {
  timezone: string | null;
  preferences: NotificationPreferences;
  urgency: string;
  now?: Date;
}): QuietHoursDecision {
  const now = params.now ?? new Date();
  const quietHours = params.preferences.quiet_hours;

  if (!quietHours.enabled) {
    return { executable: true };
  }

  if (params.urgency === 'critical' && quietHours.allow_critical) {
    return { executable: true };
  }

  const zone = resolveTimezone(params.timezone);
  const clock = getShopClock(zone, now);
  const current = clock.hour * 60 + clock.minute;
  const start = parseHHMM(quietHours.start);
  const end = parseHHMM(quietHours.end);

  if (!isInsideQuietHours(current, start, end)) {
    return { executable: true };
  }

  return {
    executable: false,
    nextAttemptAt: firstEligibleInstantAfterQuietHours({
      timezone: zone,
      now,
      quietHours,
    }),
  };
}
