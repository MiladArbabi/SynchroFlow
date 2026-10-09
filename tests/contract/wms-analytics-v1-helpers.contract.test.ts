// tests/contract/wms-analytics-v1-helpers.contract.test.ts
//
// GH-1231 — Analytics V1 pure backend helper contract (CI-gated, DB-free).
//
// Ratified contract: docs/blueprints/WarehouseAnalyticsModule.md §12B.3–§12B.5
// (U1, U2). Protects:
//   - product + variant display labels ("Default Title" suppressed;
//     search.service variantLabel precedent);
//   - IANA timezone validation with UTC fallback;
//   - last N shop-local calendar dates including today as partial — NOT a
//     rolling N×24h window, and NOT startOfShopDay() wall-clock backtracking;
//   - DST-correct local-midnight boundaries (23h and 25h days);
//   - 7d/30d daily periods; 90d Monday-start ISO weeks, partial first/last;
//   - dense zero buckets, every input counted once, out-of-window excluded.
//
// Expected production module (pure, no DB):
//   apps/backend/src/services/wms/wmsAnalyticsV1.helpers.ts
// exporting variantDisplayLabel, resolveAnalyticsTimezone, localMidnightInstant,
// buildAnalyticsWindow, densifyPacePoints.

import path from 'path';

const MODULE_REL = '../../apps/backend/src/services/wms/wmsAnalyticsV1.helpers';

function loadHelpers(): Record<string, any> | null {
  try {
    return require(MODULE_REL);
  } catch (error: any) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(path.basename(MODULE_REL))) return null;
    throw error;
  }
}

const loaded = loadHelpers();
function helpers(): Record<string, any> {
  if (!loaded) throw new Error('GH-1231 V1 contract missing: apps/backend/src/services/wms/wmsAnalyticsV1.helpers.ts is not implemented');
  return loaded;
}

const STOCKHOLM = 'Europe/Stockholm';
const HOUR = 3_600_000;

type Period = { start_date: string; end_date: string; start_at: string; end_at: string; is_current: boolean; is_clipped: boolean };

function buildWindow(days: number, timezone: string | null, nowIso: string) {
  return helpers().buildAnalyticsWindow({ days, timezone, now: new Date(nowIso) }) as {
    days: number; timezone: string; bucket: 'day' | 'week'; today_local: string; start_at: string; periods: Period[];
  };
}

const span = (p: Period) => Date.parse(p.end_at) - Date.parse(p.start_at);

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('GH-1231 helpers — product + variant display label', () => {
  it.each([
    [{ product_title: 'Mug', variant_title: 'Blue' }, 'Mug - Blue'],
    [{ product_title: '  Mug ', variant_title: ' Blue  ' }, 'Mug - Blue'],
    [{ product_title: 'Poster', variant_title: 'Default Title' }, 'Poster'],
    [{ product_title: 'Poster', variant_title: '' }, 'Poster'],
    [{ product_title: 'Poster', variant_title: null }, 'Poster'],
    [{ product_title: null, variant_title: 'Large' }, 'Large'],
  ])('%j → "%s"', (row, label) => {
    expect(helpers().variantDisplayLabel(row)).toBe(label);
  });

  it('never surfaces "Default Title", even without a product title', () => {
    expect(helpers().variantDisplayLabel({ product_title: null, variant_title: 'Default Title' })).toBe('Untitled variant');
    expect(helpers().variantDisplayLabel({ product_title: null, variant_title: null })).toBe('Untitled variant');
  });
});

describe('GH-1231 helpers — timezone validation', () => {
  it('a valid IANA zone is kept', () => {
    expect(helpers().resolveAnalyticsTimezone(STOCKHOLM)).toBe(STOCKHOLM);
    expect(helpers().resolveAnalyticsTimezone('America/New_York')).toBe('America/New_York');
  });

  it.each([null, undefined, '', 'Mars/Phobos', 'not a zone'])('%p falls back to UTC', (tz) => {
    expect(helpers().resolveAnalyticsTimezone(tz)).toBe('UTC');
  });

  it('the window echoes the effective (fallback) zone', () => {
    expect(buildWindow(7, 'Mars/Phobos', '2026-10-08T10:00:00Z').timezone).toBe('UTC');
  });
});

describe('GH-1231 helpers — DST-correct local midnight', () => {
  it.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z'], // CET midnight; spring-forward day
    ['2026-03-30', '2026-03-29T22:00:00.000Z'], // CEST midnight
    ['2026-10-25', '2026-10-24T22:00:00.000Z'], // CEST midnight; fall-back day
    ['2026-10-26', '2026-10-25T23:00:00.000Z'], // CET midnight
  ])('Stockholm %s starts at %s', (date, iso) => {
    expect(helpers().localMidnightInstant(date, STOCKHOLM).toISOString()).toBe(iso);
  });

  it('UTC midnight is unshifted', () => {
    expect(helpers().localMidnightInstant('2026-10-08', 'UTC').toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

describe('GH-1231 helpers — 7d / 30d shop-local calendar days', () => {
  it('7d: last 7 shop-local dates including today (partial, current)', () => {
    const w = buildWindow(7, STOCKHOLM, '2026-10-08T10:00:00Z');
    expect(w).toMatchObject({ days: 7, timezone: STOCKHOLM, bucket: 'day', today_local: '2026-10-08', start_at: '2026-10-01T22:00:00.000Z' });
    expect(w.periods.map((p) => p.start_date)).toEqual(
      ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
    );
    for (const p of w.periods) expect(p.end_date).toBe(p.start_date);
    expect(w.periods.map((p) => p.is_current)).toEqual([false, false, false, false, false, false, true]);
    expect(w.periods.every((p) => p.is_clipped === false)).toBe(true);
  });

  it('today is the shop-local date, not the UTC date (00:30 local on 9 Oct = 22:30Z on 8 Oct)', () => {
    const w = buildWindow(7, STOCKHOLM, '2026-10-08T22:30:00Z');
    expect(w.today_local).toBe('2026-10-09');
    expect(w.periods[w.periods.length - 1].start_date).toBe('2026-10-09');
    expect(w.periods[0].start_date).toBe('2026-10-03');
  });

  it('the window starts at local midnight, not now − days × 24h', () => {
    const w = buildWindow(7, STOCKHOLM, '2026-10-08T10:00:00Z');
    expect(w.start_at).not.toBe(new Date(Date.parse('2026-10-08T10:00:00Z') - 7 * 24 * HOUR).toISOString());
    expect(w.start_at).toBe(w.periods[0].start_at);
  });

  it('30d: 30 contiguous days ending today', () => {
    const w = buildWindow(30, STOCKHOLM, '2026-10-08T10:00:00Z');
    expect(w.bucket).toBe('day');
    expect(w.periods).toHaveLength(30);
    expect(w.periods[0].start_date).toBe('2026-09-09');
    expect(w.periods[29].start_date).toBe('2026-10-08');
    for (let i = 1; i < w.periods.length; i += 1) expect(w.periods[i].start_at).toBe(w.periods[i - 1].end_at);
  });

  it('spring-forward day is 23h; neighbours are 24h', () => {
    const w = buildWindow(7, STOCKHOLM, '2026-03-31T10:00:00Z');
    const day = w.periods.find((p) => p.start_date === '2026-03-29')!;
    expect(day.start_at).toBe('2026-03-28T23:00:00.000Z');
    expect(day.end_at).toBe('2026-03-29T22:00:00.000Z');
    expect(span(day)).toBe(23 * HOUR);
    expect(span(w.periods.find((p) => p.start_date === '2026-03-28')!)).toBe(24 * HOUR);
  });

  it('fall-back day is 25h; neighbours are 24h', () => {
    const w = buildWindow(7, STOCKHOLM, '2026-10-27T10:00:00Z');
    const day = w.periods.find((p) => p.start_date === '2026-10-25')!;
    expect(day.start_at).toBe('2026-10-24T22:00:00.000Z');
    expect(day.end_at).toBe('2026-10-25T23:00:00.000Z');
    expect(span(day)).toBe(25 * HOUR);
    expect(span(w.periods.find((p) => p.start_date === '2026-10-26')!)).toBe(24 * HOUR);
  });

  it('only 7, 30 and 90 are supported windows', () => {
    expect(() => buildWindow(14, STOCKHOLM, '2026-10-08T10:00:00Z')).toThrow(RangeError);
  });
});

describe('GH-1231 helpers — 90d Monday-start ISO weeks', () => {
  // 2026-10-08 is a Thursday; today − 89 = 2026-07-11 (Saturday).
  const w = () => buildWindow(90, STOCKHOLM, '2026-10-08T10:00:00Z');

  it('uses weekly buckets covering exactly 90 shop-local dates', () => {
    const { bucket, periods } = w();
    expect(bucket).toBe('week');
    expect(periods[0].start_date).toBe('2026-07-11');
    expect(periods[periods.length - 1].end_date).toBe('2026-10-08');
    const covered = periods.reduce((n, p) => n + (Date.parse(p.end_date) - Date.parse(p.start_date)) / 86_400_000 + 1, 0);
    expect(covered).toBe(90);
  });

  it('partial first week is clipped at the window start and ends on Sunday', () => {
    const first = w().periods[0];
    expect(first).toMatchObject({ start_date: '2026-07-11', end_date: '2026-07-12', is_clipped: true, is_current: false });
  });

  it('full weeks run Monday → Sunday, contiguous, unclipped', () => {
    const { periods } = w();
    for (const p of periods.slice(1, -1)) {
      expect(new Date(`${p.start_date}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(p.end_date).toBe(addDays(p.start_date, 6));
      expect(p.is_clipped).toBe(false);
      expect(p.is_current).toBe(false);
    }
    for (let i = 1; i < periods.length; i += 1) {
      expect(periods[i].start_date).toBe(addDays(periods[i - 1].end_date, 1));
      expect(periods[i].start_at).toBe(periods[i - 1].end_at);
    }
  });

  it('the partial last week is the current week ("this week so far")', () => {
    const { periods } = w();
    const last = periods[periods.length - 1];
    expect(last).toMatchObject({ start_date: '2026-10-05', end_date: '2026-10-08', is_current: true });
    expect(periods.filter((p) => p.is_current)).toHaveLength(1);
  });
});

describe('GH-1231 helpers — dense pace points', () => {
  const w7 = () => buildWindow(7, STOCKHOLM, '2026-10-08T10:00:00Z');

  it('no activity: one genuine-zero point per period, total 0', () => {
    const out = helpers().densifyPacePoints(w7(), []);
    expect(out.items_picked_total).toBe(0);
    expect(out.points).toHaveLength(7);
    expect(out.points.every((p: { items_picked: number }) => p.items_picked === 0)).toBe(true);
  });

  it('each input row is counted exactly once; out-of-window rows are excluded; total = Σ points', () => {
    const out = helpers().densifyPacePoints(w7(), [
      { local_date: '2026-10-03', items_picked: 5 },
      { local_date: '2026-10-03', items_picked: 2 },
      { local_date: '2026-10-08', items_picked: 4 },
      { local_date: '2026-10-01', items_picked: 99 }, // before window start
      { local_date: '2026-10-09', items_picked: 50 }, // after today
    ]);
    const byDate = Object.fromEntries(out.points.map((p: { start_date: string; items_picked: number }) => [p.start_date, p.items_picked]));
    expect(byDate).toEqual({
      '2026-10-02': 0, '2026-10-03': 7, '2026-10-04': 0, '2026-10-05': 0, '2026-10-06': 0, '2026-10-07': 0, '2026-10-08': 4,
    });
    expect(out.items_picked_total).toBe(11);
    expect(out.items_picked_total).toBe(out.points.reduce((a: number, p: { items_picked: number }) => a + p.items_picked, 0));
  });

  it('points carry the period date labels and current/clipped flags', () => {
    const out = helpers().densifyPacePoints(w7(), []);
    expect(out.points[6]).toEqual({ start_date: '2026-10-08', end_date: '2026-10-08', items_picked: 0, is_current: true, is_clipped: false });
  });

  it('90d: daily rows aggregate into their Monday-start week; nothing is lost or duplicated', () => {
    const w = buildWindow(90, STOCKHOLM, '2026-10-08T10:00:00Z');
    const out = helpers().densifyPacePoints(w, [
      { local_date: '2026-07-11', items_picked: 1 }, // Sat — clipped first week
      { local_date: '2026-07-12', items_picked: 2 }, // Sun — clipped first week
      { local_date: '2026-07-13', items_picked: 3 }, // Mon — next week
      { local_date: '2026-10-05', items_picked: 4 }, // Mon — current week
      { local_date: '2026-10-08', items_picked: 5 }, // today — current week
    ]);
    expect(out.points).toHaveLength(w.periods.length);
    expect(out.points[0]).toMatchObject({ start_date: '2026-07-11', end_date: '2026-07-12', items_picked: 3, is_clipped: true });
    expect(out.points[1]).toMatchObject({ start_date: '2026-07-13', items_picked: 3 });
    expect(out.points[out.points.length - 1]).toMatchObject({ start_date: '2026-10-05', items_picked: 9, is_current: true });
    expect(out.items_picked_total).toBe(15);
  });
});

describe('GH-1231 helpers — input hardening (GREEN-1 review)', () => {
  const w7 = () => buildWindow(7, STOCKHOLM, '2026-10-08T10:00:00Z');
  const row = (items_picked: unknown, local_date = '2026-10-08') => [{ local_date, items_picked }];

  it.each(['', '  ', '0x10', '1e2', '1.5', '-1', ' 5', '5 ', '+5', '05', 'NaN', 'Infinity'])(
    'quantity string %j is rejected, never coerced into an invented count',
    (value) => {
      expect(() => helpers().densifyPacePoints(w7(), row(value))).toThrow();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, Number.MAX_SAFE_INTEGER + 1])('quantity number %p is rejected', (value) => {
    expect(() => helpers().densifyPacePoints(w7(), row(value))).toThrow();
  });

  it('canonical decimal strings (Postgres SUM text) and safe integers are accepted', () => {
    const out = helpers().densifyPacePoints(w7(), [
      { local_date: '2026-10-08', items_picked: '0' },
      { local_date: '2026-10-08', items_picked: '12' },
      { local_date: '2026-10-07', items_picked: 3 },
    ]);
    expect(out.items_picked_total).toBe(15);
  });

  it('an aggregate that leaves the safe integer range is rejected (bucket and grand total)', () => {
    const big = String(Number.MAX_SAFE_INTEGER);
    expect(() => helpers().densifyPacePoints(w7(), [
      { local_date: '2026-10-08', items_picked: big },
      { local_date: '2026-10-08', items_picked: '1' },
    ])).toThrow();
    expect(() => helpers().densifyPacePoints(w7(), [
      { local_date: '2026-10-07', items_picked: big },
      { local_date: '2026-10-08', items_picked: '1' },
    ])).toThrow();
  });

  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-01', '20261008'])(
    'impossible or malformed date %s is rejected, never normalized',
    (date) => {
      expect(() => helpers().localMidnightInstant(date, STOCKHOLM)).toThrow();
      expect(() => helpers().densifyPacePoints(w7(), row(1, date))).toThrow();
    },
  );

  it('a real leap day is accepted', () => {
    expect(helpers().localMidnightInstant('2028-02-29', 'UTC').toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});
