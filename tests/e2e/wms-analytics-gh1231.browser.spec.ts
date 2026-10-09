// tests/e2e/wms-analytics-gh1231.browser.spec.ts
//
// GH-1231 visual remediation (R1–R4, R6) — real-browser certification of the
// Analytics V1 owner screen against a running local stack (Vite + API).
//
// Measures the actual AppLayout scroll root and card rectangles; nothing here
// is inferred from screenshots. Contracts:
//   - 1440×720 and 1024×820 (light + dark): two columns, no primary-workspace
//     vertical or horizontal scroll, four cards + Costs unclipped, ≥2 Problem
//     products and ≥1 Team person, no overlapping text or escaped CTA, the
//     requested theme actually rendered, text contrast ≥ 4.5:1.
//   - 390×844: one card per row, natural vertical scroll, no horizontal
//     overflow, no overlap, contextual Details opens/closes/restores focus.
//   - Pace: rendered bar height = items_picked / largest bucket; zero = no bar;
//     7d = 7 days, 30d = 30 days, 90d = the exact Monday-based weeks of the
//     shop-local window (contiguous, first week clipped, last week current).
//   - Details: nonmodal, Escape/Close restore focus; withdrawn while the Ops
//     Console is open and restored with the same selection and period.
//   - Final UX cleanup (owner-ratified 2026-10-09): zero Pace buckets are
//     inert; Flow stays live across 7/30/90; Team column headers sit over
//     their bar halves; every text link is a ghost-orange action with its
//     real destination, and static text is never orange (except the Team
//     "Items picked" header, which matches its bar).
//
// Data: "real" runs use the signed-in shop's own responses unchanged.
// "populated" / "zero" runs take the real responses (so window, timezone and
// freshness stay server-valid) and replace only the counts. Synthetic counts
// reconcile: Team items picked are derived from the same Pace buckets.
//
// Missing credentials FAIL (a skip never certifies). Run with
// playwright.gh1231.config.ts — see that file for the command.

import { test, expect, type Page, type Route } from '@playwright/test';

const EMAIL = process.env.LASYNCRO_E2E_EMAIL ?? '';
const PASSWORD = process.env.LASYNCRO_E2E_PASSWORD ?? '';

type Mode = 'light' | 'dark';
type Data = 'real' | 'populated' | 'zero';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Synthetic counts (reconciled) ───────────────────────────────────────────

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function populatedHistorical(real: Json): Json {
  const points = (real.pace?.points ?? []) as Json[];
  // Deterministic mix of zero and nonzero buckets; the current bucket is small.
  const items = points.map((_, i) => (i === points.length - 1 ? 3 : i % 3 === 1 ? 0 : 4 + ((i * 7) % 23)));
  // Each bucket's picks belong to one person, so Team reconciles with Pace by
  // construction. The third person packs only (0 picked).
  const picked = [0, 0, 0];
  items.forEach((n, i) => { picked[i % 2] += n; });
  return {
    ...real,
    pace: { ...real.pace, items_picked_total: sum(items), points: points.map((p, i) => ({ ...p, items_picked: items[i] })) },
    problems: {
      total: 9, open_total: 3, by_type: { short_pick: 4, item_missing: 3, wrong_item: 2 },
      products: [
        { lasyncro_variant_id: 'gh1231-v1', display_label: 'Ceramic Pour-Over Coffee Dripper - Matte Charcoal / Large', sku: 'CPO-MC-L', count: 4 },
        { lasyncro_variant_id: 'gh1231-v2', display_label: 'Linen Tea Towel', sku: null, count: 3 },
        { lasyncro_variant_id: 'gh1231-v3', display_label: 'Mug - Blue', sku: 'MUG-BL', count: 2 },
      ],
      products_total: 3,
    },
    team_activity: [
      { user_id: 900001, display_name: 'Alexandra Montgomery-Lindqvist', items_picked: picked[0], items_packed: 12, is_current_member: true },
      { user_id: 900002, display_name: 'Bo Ek', items_picked: picked[1], items_packed: 37, is_current_member: false },
      { user_id: 900003, display_name: 'Chen Wu', items_picked: picked[2], items_packed: 5, is_current_member: true },
    ],
  };
}

function zeroHistorical(real: Json): Json {
  return {
    ...real,
    pace: { ...real.pace, items_picked_total: 0, points: (real.pace?.points ?? []).map((p: Json) => ({ ...p, items_picked: 0 })) },
    problems: { total: 0, open_total: 0, by_type: {}, products: [], products_total: 0 },
    team_activity: [],
  };
}

const STAGES = ['awaiting_pick', 'picking', 'picked', 'packing', 'packed'];
function populatedLive(real: Json): Json {
  const ages = [10_800, 2_700, 6_213_600, 604_800, 30];
  const counts = [17, 3, 128, 1, 6];
  return { ...real, flow: { stages: Object.fromEntries(STAGES.map((s, i) => [s, { count: counts[i], oldest_age_s: ages[i] }])) } };
}
function zeroLive(real: Json): Json {
  return { ...real, flow: { stages: Object.fromEntries(STAGES.map((s) => [s, { count: 0, oldest_age_s: null }])) } };
}

/** Synthetic payloads must be internally consistent before they certify anything. */
function expectSyntheticAccounting(h: Json) {
  const paceTotal = h.pace.items_picked_total;
  expect(sum(h.pace.points.map((p: Json) => p.items_picked)), 'Σ Pace buckets = Pace total').toBe(paceTotal);
  expect(sum(h.team_activity.map((r: Json) => r.items_picked)), 'Σ Team items_picked = Pace total').toBe(paceTotal);
  expect(sum(Object.values(h.problems.by_type) as number[]), 'Σ problem types = problems total').toBe(h.problems.total);
}

// ─── Session ─────────────────────────────────────────────────────────────────

const HISTORICAL = /\/api\/v1\/wms\/analytics(\?|$)/;
const LIVE = /\/api\/v1\/wms\/analytics\/live(\?|$)/;

/** Historical bodies the page actually received, by window (after any rewrite). */
const received = new WeakMap<Page, Map<number, Json>>();

async function routeAnalytics(page: Page, data: Data) {
  if (data === 'real') return;
  const rewrite = (fn: (real: Json) => Json) => async (route: Route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: fn(await response.json()) });
  };
  await page.route(LIVE, rewrite(data === 'zero' ? zeroLive : populatedLive));
  await page.route(HISTORICAL, rewrite(data === 'zero' ? zeroHistorical : populatedHistorical));
}

async function openAnalytics(page: Page, { mode, data }: { mode: Mode; data: Data }) {
  if (!EMAIL || !PASSWORD) throw new Error('LASYNCRO_E2E_EMAIL and LASYNCRO_E2E_PASSWORD are required; GH-1231 certification never skips.');
  await page.emulateMedia({ colorScheme: mode });
  await page.addInitScript((m) => { try { localStorage.setItem('theme-mode', m); } catch { /* storage blocked */ } }, mode);
  const bodies = new Map<number, Json>();
  received.set(page, bodies);
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (!HISTORICAL.test(url.pathname) || !response.ok()) return;
    try { bodies.set(Number(url.searchParams.get('days')), await response.json()); } catch { /* navigation */ }
  });
  await page.goto('/login');
  await page.locator('#outlined-adornment-email-login').fill(EMAIL);
  await page.locator('#outlined-adornment-password-login').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await routeAnalytics(page, data);
  await page.goto('/wms/analytics');
  await expect(page.getByRole('heading', { name: 'Are we keeping up?' })).toBeVisible();
  await expect(page.locator('[data-pace-point]').first()).toBeVisible();
  await expect(page.locator('[role="status"][aria-label="Loading analytics"]')).toHaveCount(0);
  if (data !== 'real') expectSyntheticAccounting(await historicalBody(page, 30));
}

async function historicalBody(page: Page, days: number): Promise<Json> {
  await expect.poll(() => received.get(page)?.has(days), { message: `historical ${days}d response` }).toBe(true);
  return received.get(page)!.get(days)!;
}

// ─── Pace periods (exact) ────────────────────────────────────────────────────

type Period = { start: string; end: string; current: boolean; clipped: boolean };

const shift = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isoWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

/** Days, or Monday-based weeks, covering the shop-local window that ends today. */
function expectedPeriods(days: number, todayLocal: string): Period[] {
  const first = shift(todayLocal, -(days - 1));
  const periods: Period[] = [];
  if (days !== 90) {
    for (let i = 0; i < days; i += 1) periods.push({ start: shift(first, i), end: shift(first, i), current: i === days - 1, clipped: false });
    return periods;
  }
  for (let start = first; start <= todayLocal;) {
    const sunday = shift(start, 7 - isoWeekday(start));
    const end = sunday < todayLocal ? sunday : todayLocal;
    periods.push({ start, end, current: end === todayLocal, clipped: start === first && isoWeekday(start) !== 1 });
    start = shift(end, 1);
  }
  return periods;
}

/** Selects a window and proves the plotted periods are exactly that window's buckets. */
async function selectWindow(page: Page, days: 7 | 30 | 90) {
  await page.getByRole('button', { name: `${days}d` }).click();
  await expect(page.getByRole('button', { name: `${days}d` })).toHaveAttribute('aria-pressed', 'true');
  const body = await historicalBody(page, days);
  const { timezone, today_local: today } = body.window;
  // The server's shop-local today, checked independently against its timezone.
  const now = Date.now();
  const localToday = [now - 120_000, now, now + 120_000].map((t) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(t));
  expect(localToday, `today_local ${today} in ${timezone}`).toContain(today);

  const expected = expectedPeriods(days, today);
  if (days === 7) expect(expected).toHaveLength(7);
  if (days === 30) expect(expected).toHaveLength(30);
  await expect(page.locator('[data-pace-point]')).toHaveCount(expected.length);
  const plotted: Period[] = (await page.locator('[data-pace-point]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))).map((label) => {
    const m = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}):/.exec(label)!;
    return { start: m[1], end: m[2], current: label.includes('partial current period'), clipped: label.includes('partial first week') };
  });
  expect(plotted).toEqual(expected);
  for (let i = 1; i < plotted.length; i += 1) expect(plotted[i].start, 'contiguous periods').toBe(shift(plotted[i - 1].end, 1));
  if (days === 90) {
    plotted.slice(1).forEach((p) => expect(isoWeekday(p.start), `${p.start} is a Monday`).toBe(1));
    plotted.slice(0, -1).forEach((p) => expect(isoWeekday(p.end), `${p.end} is a Sunday`).toBe(7));
  }
  expect(await page.locator('[data-pace-point]').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-items-picked')))))
    .toEqual(body.pace.points.map((p: Json) => p.items_picked));
}

// ─── Measurement ─────────────────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number; top: number; bottom: number; left: number; right: number };

/** Everything measured in one pass, inside the page. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };

    // Any CSS color (incl. oklch / color-mix) → sRGB via canvas.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r1, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r1, g, b, a / 255]; };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const background = (el: Element | null): number[] => {
      const layers: number[][] = [];
      for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255, 1]);
    };
    const lum = (c: number[]) => { const [R, G, B] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
    const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

    const workspace = document.querySelector<HTMLElement>('[data-analytics-workspace]')!;
    let root: HTMLElement | null = workspace.parentElement;
    while (root && !['auto', 'scroll'].includes(getComputedStyle(root).overflowY)) root = root.parentElement;
    const doc = document.scrollingElement as HTMLElement;
    const names = ['Pace', 'Flow', 'Problems', 'Team', 'Costs'];
    const regions = Object.fromEntries(names.map((n) => [n, document.querySelector(`section[aria-label="${n}"]`)]));

    // Visible leaf text elements per region (visually-hidden helpers excluded).
    const leafText = (container: Element) => [...container.querySelectorAll<HTMLElement>('*')].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && el.getBoundingClientRect().width > 2 && el.getBoundingClientRect().height > 2);
    const overlaps: string[] = [];
    const escapes: string[] = [];
    const texts: { text: string; px: number; contrast: number; region: string }[] = [];
    for (const [name, region] of Object.entries(regions)) {
      if (!region) continue;
      const box = region.getBoundingClientRect();
      const leaves = leafText(region);
      for (const el of [...leaves, ...region.querySelectorAll<HTMLElement>('a, button, [data-pace-bar]')]) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (b.left < box.left - 1 || b.right > box.right + 1 || b.top < box.top - 1 || b.bottom > box.bottom + 1) escapes.push(`${name}: "${(el.textContent ?? el.tagName).trim().slice(0, 40)}"`);
      }
      for (let i = 0; i < leaves.length; i += 1) {
        const s = getComputedStyle(leaves[i]);
        const bg = background(leaves[i]);
        texts.push({ text: leaves[i].textContent!.trim().slice(0, 40), px: parseFloat(s.fontSize), contrast: Math.round(contrast(over(rgba(s.color), bg), bg) * 100) / 100, region: name });
        for (let j = i + 1; j < leaves.length; j += 1) {
          if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
          const a = leaves[i].getBoundingClientRect(); const c = leaves[j].getBoundingClientRect();
          const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left); const iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (ix > 1 && iy > 1) overlaps.push(`${name}: "${leaves[i].textContent!.trim().slice(0, 30)}" × "${leaves[j].textContent!.trim().slice(0, 30)}"`);
        }
      }
    }
    const bars = [...document.querySelectorAll<HTMLElement>('[data-pace-point]')].map((btn) => {
      const bar = btn.querySelector('[data-pace-bar]');
      return { items: Number(btn.dataset.itemsPicked), slot: btn.getBoundingClientRect().height, bar: bar ? bar.getBoundingClientRect().height : 0, hasBar: !!bar };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scheme: document.documentElement.getAttribute('data-color-scheme'),
      luminance: { page: Math.round(lum(background(workspace)) * 1000) / 1000, card: regions.Pace ? Math.round(lum(background(regions.Pace)) * 1000) / 1000 : null },
      columns: Number(workspace.dataset.analyticsColumns),
      scrollRoot: root && {
        tag: root.tagName.toLowerCase(), id: root.id, cls: root.className.toString().split(' ').filter((c) => !/^css-/.test(c)).join(' '),
        overflowY: getComputedStyle(root).overflowY, rect: r(root),
        scrollHeight: root.scrollHeight, clientHeight: root.clientHeight, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollTop: root.scrollTop,
      },
      document: { scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth },
      workspace: r(workspace),
      regions: Object.fromEntries(Object.entries(regions).map(([n, el]) => [n, el ? r(el) : null])) as Record<string, Rect | null>,
      products: [...document.querySelectorAll('[data-analytics-product]')].map(r),
      people: [...document.querySelectorAll('[data-analytics-person]')].map(r),
      bars, overlaps, escapes, texts,
    };
  });
}

type M = Awaited<ReturnType<typeof measure>>;

/** scrollTop of the AppLayout scroll root (same ancestor walk as measure()). */
async function scrollRootTop(page: Page) {
  return page.evaluate(() => {
    let root = document.querySelector('[data-analytics-workspace]')!.parentElement;
    while (root && !['auto', 'scroll'].includes(getComputedStyle(root).overflowY)) root = root.parentElement;
    return root!.scrollTop;
  });
}

/** Measurement log: one JSON file per measurement plus a console line. */
async function record(label: string, m: M) {
  const { texts, ...rest } = m;
  const summary = { ...rest, fontMin: Math.min(...texts.map((t) => t.px)), contrastMin: Math.min(...texts.map((t) => t.contrast)), below12px: texts.filter((t) => t.px < 12) };
  console.log(`GH1231_MEASURE ${label} ${JSON.stringify(summary)}`);
  await test.info().attach(`${label}.json`, { body: JSON.stringify(m, null, 2), contentType: 'application/json' });
}

const inside = (a: Rect, b: Rect) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
const intersects = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
const CARDS = ['Pace', 'Flow', 'Problems', 'Team'];

/** Text below 12px is allowed only for chart axes and legends (≥11px). */
const AXIS_OR_LEGEND = /^(\d[\d,]*|\p{L}{3,5}\.? \d{1,2}|\d{1,2}\.? \p{L}{3,5}\.?|← Items picked|Items packed →|.+ · \d[\d,]*)$/u;

function expectCommonTruth(m: M, mode: Mode) {
  // The requested theme actually rendered.
  expect(m.scheme).toBe(mode);
  if (mode === 'light') { expect(m.luminance.page).toBeGreaterThan(0.6); expect(m.luminance.card).toBeGreaterThan(0.6); }
  else { expect(m.luminance.page).toBeLessThan(0.2); expect(m.luminance.card).toBeLessThan(0.2); }
  for (const t of m.texts) {
    expect(t.px, `font ${t.region} "${t.text}"`).toBeGreaterThanOrEqual(11);
    if (t.px < 12) expect(t.text, `${t.px}px informational text in ${t.region}`).toMatch(AXIS_OR_LEGEND);
    expect(t.contrast, `${mode} contrast ${t.region} "${t.text}"`).toBeGreaterThanOrEqual(4.5);
  }
  expect(m.overlaps, 'overlapping text').toEqual([]);
  expect(m.escapes, 'content outside its card').toEqual([]);
  // Pace bars: proportional to the largest real bucket; zero draws nothing.
  const max = Math.max(0, ...m.bars.map((b) => b.items));
  for (const b of m.bars) {
    if (b.items === 0) { expect(b.hasBar).toBe(false); expect(b.bar).toBe(0); }
    else expect(Math.abs(b.bar - (b.items / max) * b.slot)).toBeLessThanOrEqual(1.5);
  }
  for (let i = 0; i < CARDS.length; i += 1) for (let j = i + 1; j < CARDS.length; j += 1) {
    expect(intersects(m.regions[CARDS[i]]!, m.regions[CARDS[j]]!), `${CARDS[i]} overlaps ${CARDS[j]}`).toBe(false);
  }
  expect(intersects(m.regions.Costs!, m.regions.Team!) || intersects(m.regions.Costs!, m.regions.Problems!)).toBe(false);
}

// ─── Cast menu ───────────────────────────────────────────────────────────────

const CAST_LABELS = ['Cast to Floor Display', 'Paste into any TV browser', 'Launch in a new tab'];

/** Opens the Cast menu and measures its three secondary labels against their real background. */
async function castLabels(page: Page) {
  await page.getByRole('button', { name: 'Cast to display' }).click();
  for (const label of CAST_LABELS) await expect(page.getByText(label, { exact: true })).toBeVisible();
  const labels = await page.evaluate((texts) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
    const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
    const background = (el: Element | null): number[] => {
      const layers: number[][] = [];
      for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
      return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255, 1]);
    };
    const lum = (c: number[]) => { const [R, G, B] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
    const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const all = [...document.querySelectorAll<HTMLElement>('.MuiPopper-root p')];
    return texts.map((text) => {
      const el = all.find((e) => e.textContent?.trim() === text)!;
      const s = getComputedStyle(el); const bg = background(el);
      return { text, px: parseFloat(s.fontSize), color: s.color, contrast: Math.round(contrast(over(rgba(s.color), bg), bg) * 100) / 100 };
    });
  }, CAST_LABELS);
  await page.getByRole('button', { name: 'Cast to display' }).click();
  await expect(page.getByText(CAST_LABELS[1], { exact: true })).toHaveCount(0);
  return labels;
}

// ─── Details / Console ───────────────────────────────────────────────────────

async function expectDetailsCycle(page: Page, trigger: ReturnType<Page['locator']>, via: 'Escape' | 'Close') {
  await trigger.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details).toBeVisible();
  await expect(details.getByRole('button', { name: 'Close Details' })).toBeFocused();
  const box = (await details.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y, 'Details top within viewport').toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, 'Details bottom within viewport').toBeLessThanOrEqual(vp.height + 1);
  expect(await page.locator('section[aria-label="Pace"]').evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(false);
  if (via === 'Escape') await page.keyboard.press('Escape');
  else await details.getByRole('button', { name: 'Close Details' }).click();
  await expect(details).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

// ─── Final UX cleanup ────────────────────────────────────────────────────────

/** Links, orange static text, Team column geometry and inert Pace buckets, measured in one pass. */
async function uxHierarchy(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (css: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
    const orange = (css: string) => { const [r, g, b] = rgba(css); return r - b > 80 && r > g; };
    const rect = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
    const sections = [...document.querySelectorAll('section[aria-label]')];
    const links = sections.flatMap((s) => [...s.querySelectorAll<HTMLAnchorElement>('a')]).map((a) => ({
      text: a.textContent!.trim(), href: a.getAttribute('href'), orange: orange(getComputedStyle(a).color), ghost: rgba(getComputedStyle(a).backgroundColor)[3] > 0,
    }));
    const orangeStatic = sections.flatMap((s) => [...s.querySelectorAll<HTMLElement>('*')])
      .filter((el) => !el.closest('a, button') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && orange(getComputedStyle(el).color))
      .map((el) => el.textContent!.trim());
    const team = document.querySelector('section[aria-label="Team"]')!;
    const header = (c: string) => team.querySelector(`p[data-analytics-team-column="${c}"]`);
    const half = (c: string) => team.querySelector(`[data-analytics-person] [data-analytics-team-column="${c}"]`);
    const zeroPoints = [...document.querySelectorAll<HTMLElement>('[data-pace-point][data-items-picked="0"]')].map((el) => ({ tag: el.tagName, tabIndex: el.tabIndex }));
    return {
      links, orangeStatic, zeroPoints,
      team: ['picked', 'packed'].map((c) => ({ column: c, header: header(c) && rect(header(c)!), half: half(c) && rect(half(c)!), text: header(c)?.textContent })),
    };
  });
}

function expectUxHierarchy(ux: Awaited<ReturnType<typeof uxHierarchy>>) {
  const hrefs: Record<string, string> = { 'Open Order Flow →': '/orders/flow', 'Open Problem Center →': '/problem-center', 'Open Team →': '/team' };
  expect(ux.links.length, 'text links on the screen').toBeGreaterThanOrEqual(2);
  for (const l of ux.links) {
    expect(l.href, `"${l.text}" destination`).toBe(hrefs[l.text]);
    expect(l.orange, `"${l.text}" is ghost-orange text`).toBe(true);
    expect(l.ghost, `"${l.text}" has the ghost fill`).toBe(true);
  }
  expect(ux.orangeStatic, 'static text in action orange').toEqual(['Items picked']);
  for (const t of ux.team) {
    expect(t.header, `${t.column} header`).not.toBeNull();
    expect(t.half, `${t.column} bar half`).not.toBeNull();
    expect(t.text).not.toMatch(/[←→]/);
    expect(t.header!.bottom, `${t.column} header above the rows`).toBeLessThanOrEqual(t.half!.top + 1);
    expect(t.header!.left, `${t.column} header over its half`).toBeGreaterThanOrEqual(t.half!.left - 1);
    expect(t.header!.right, `${t.column} header over its half`).toBeLessThanOrEqual(t.half!.right + 1);
  }
  // Picked bars grow toward the centre line, so its header is right-aligned on it.
  expect(Math.abs(ux.team[0].header!.right - ux.team[0].half!.right)).toBeLessThanOrEqual(2);
  for (const z of ux.zeroPoints) { expect(z.tag, 'zero Pace bucket is not a button').not.toBe('BUTTON'); expect(z.tabIndex).toBe(-1); }
}

// ─── Certified viewports: no primary scroll ──────────────────────────────────

for (const [w, h] of [[1440, 720], [1024, 820]] as const) {
  for (const mode of ['light', 'dark'] as Mode[]) {
    test(`GH-1231 ${w}×${h} ${mode} populated: two columns, no primary scroll, nothing clipped`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openAnalytics(page, { mode, data: 'populated' });
      const m = await measure(page);
      await record(`${w}x${h}-${mode}-populated`, m);

      expect(m.viewport).toEqual({ w, h });
      expect(m.columns).toBe(2);
      expect(m.scrollRoot, 'AppLayout scroll root').not.toBeNull();
      expect(m.scrollRoot!.scrollHeight).toBeLessThanOrEqual(m.scrollRoot!.clientHeight);
      expect(m.scrollRoot!.scrollWidth).toBeLessThanOrEqual(m.scrollRoot!.clientWidth);
      expect(m.document.scrollHeight).toBeLessThanOrEqual(m.document.clientHeight);
      expect(m.document.scrollWidth).toBeLessThanOrEqual(m.document.clientWidth);
      for (const name of [...CARDS, 'Costs']) expect(inside(m.regions[name]!, m.scrollRoot!.rect), `${name} clipped`).toBe(true);
      expect(m.products.filter((p) => inside(p, m.regions.Problems!)).length).toBeGreaterThanOrEqual(2);
      expect(m.people.filter((p) => inside(p, m.regions.Team!)).length).toBeGreaterThanOrEqual(1);
      expectCommonTruth(m, mode);
      const ux = await uxHierarchy(page);
      console.log(`GH1231_UX ${w}x${h}-${mode} ${JSON.stringify(ux)}`);
      expectUxHierarchy(ux);
      expect(ux.zeroPoints.length, 'populated data has zero buckets').toBeGreaterThan(0);
      await page.screenshot({ path: test.info().outputPath(`gh1231-${w}x${h}-${mode}.png`) });

      const cast = await castLabels(page);
      console.log(`GH1231_CAST ${w}x${h}-${mode} ${JSON.stringify(cast)}`);
      for (const c of cast) {
        expect(c.px, `Cast "${c.text}" font`).toBeGreaterThanOrEqual(12);
        expect(c.contrast, `${mode} Cast "${c.text}" contrast`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
}

test('GH-1231 1440×720 Details, Ops Console and period changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await openAnalytics(page, { mode: 'light', data: 'populated' });
  const flow = page.locator('section[aria-label="Flow"]');
  // A zero bucket opens nothing.
  const zero = page.locator('[data-pace-point][data-items-picked="0"]').first();
  await zero.click();
  await expect(page.getByRole('dialog', { name: 'Details' })).toHaveCount(0);
  const flowRows = await flow.locator('button').allTextContents();
  expect(flowRows).toHaveLength(5);
  await expect(flow.getByText('Orders waiting the longest in each step', { exact: true })).toBeVisible();
  await expectDetailsCycle(page, flow.getByRole('button', { name: /waiting to be packed/i }), 'Escape');
  await expectDetailsCycle(page, page.locator('[data-pace-point]').first(), 'Close');
  await expectDetailsCycle(page, page.locator('[data-analytics-product]').first(), 'Escape');
  await expectDetailsCycle(page, page.locator('[data-analytics-person]').first(), 'Close');

  // Ops Console: Details withdraws, then returns with the same selection and period.
  await selectWindow(page, 7);
  await flow.getByRole('button', { name: /being picked/i }).click();
  const details = page.getByRole('dialog', { name: 'Details' });
  await expect(details).toContainText('Being picked');
  await page.getByRole('button', { name: /^Ops Console —/ }).click();
  await expect(page.getByRole('button', { name: 'Close Ops Console' })).toBeVisible();
  await expect(details).toHaveCount(0);
  const withConsole = await measure(page);
  await record('1440x720-console-open', withConsole);
  expect(withConsole.overlaps).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('gh1231-1440x720-console-open.png') });
  await page.getByRole('button', { name: 'Close Ops Console' }).click();
  await expect(details).toContainText('Being picked');
  await expect(page.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  for (const days of [30, 90] as const) {
    await selectWindow(page, days);
    expectSyntheticAccounting(await historicalBody(page, days));
    const m = await measure(page);
    await record(`1440x720-populated-${days}d`, m);
    expect(m.scrollRoot!.scrollHeight).toBeLessThanOrEqual(m.scrollRoot!.clientHeight);
    expectCommonTruth(m, 'light');
    // Flow is live: the historical window never changes it.
    expect(await flow.locator('button').allTextContents(), `Flow after ${days}d`).toEqual(flowRows);
  }
  await page.screenshot({ path: test.info().outputPath('gh1231-1440x720-90d.png') });

  // Cast deep link: the real in-app link (no page.goto) lands on Warehouse
  // Settings, where Floor Display tokens are managed.
  await page.getByRole('button', { name: 'Cast to display' }).click();
  await page.getByRole('link', { name: 'Manage displays in Settings →' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings/warehouse');
  await expect(page.getByText('Floor Display', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Generate token-bound URLs for warehouse TVs\./)).toBeVisible();
  await expect(page.getByText(/^(No active displays|\d+ displays? active)$/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('gh1231-cast-settings-warehouse.png') });
});

// ─── Narrow: one column, natural scroll ──────────────────────────────────────

for (const data of ['populated', 'zero'] as Data[]) {
  test(`GH-1231 390×844 ${data}: one card per row, natural scroll, no overlap`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalytics(page, { mode: 'light', data });
    const m = await measure(page);
    await record(`390x844-${data}`, m);

    expect(m.columns).toBe(1);
    const cards = CARDS.map((n) => m.regions[n]!);
    for (let i = 1; i < cards.length; i += 1) {
      expect(cards[i].top, `${CARDS[i]} shares a row`).toBeGreaterThanOrEqual(cards[i - 1].bottom);
      expect(Math.abs(cards[i].left - cards[0].left)).toBeLessThanOrEqual(1);
    }
    expect(m.scrollRoot!.scrollHeight, 'stacked layout overflows the AppLayout scroll root').toBeGreaterThan(m.scrollRoot!.clientHeight);
    expect(m.scrollRoot!.scrollWidth).toBeLessThanOrEqual(m.scrollRoot!.clientWidth);
    expect(m.document.scrollWidth).toBeLessThanOrEqual(m.document.clientWidth);
    for (const name of [...CARDS, 'Costs']) {
      expect(m.regions[name]!.left).toBeGreaterThanOrEqual(0);
      expect(m.regions[name]!.right).toBeLessThanOrEqual(390);
    }
    expectCommonTruth(m, 'light');
    if (data === 'zero') expect(m.bars.every((b) => !b.hasBar)).toBe(true);

    // Natural scrolling reaches the last card and Costs.
    const topBefore = await scrollRootTop(page);
    await page.locator('section[aria-label="Costs"]').scrollIntoViewIfNeeded();
    await expect(page.locator('section[aria-label="Costs"]')).toBeInViewport();
    expect(await scrollRootTop(page), 'AppLayout scroll root scrolled to Costs').toBeGreaterThan(topBefore);
    const flowStage = page.locator('section[aria-label="Flow"]').getByRole('button', { name: /waiting to be picked/i });
    await flowStage.scrollIntoViewIfNeeded();
    await expectDetailsCycle(page, flowStage, 'Escape');
    const lastPoint = page.locator('[data-pace-point]').last();
    if (data === 'zero') {
      // Every bucket is zero: inert, nothing to open.
      expect(await lastPoint.evaluate((el) => [el.tagName, el.tabIndex])).toEqual(['DIV', -1]);
      await lastPoint.click();
      await expect(page.getByRole('dialog', { name: 'Details' })).toHaveCount(0);
    } else await expectDetailsCycle(page, lastPoint, 'Close');
    await page.screenshot({ path: test.info().outputPath(`gh1231-390x844-${data}.png`), fullPage: true });
  });
}

// ─── Real shop data: bar truth with the server's own numbers ─────────────────

test('GH-1231 real data 7d/30d/90d: exact periods, bars match confirmed items, zero draws nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await openAnalytics(page, { mode: 'light', data: 'real' });
  for (const days of [7, 30, 90] as const) {
    await selectWindow(page, days);
    const m = await measure(page);
    await record(`1440x720-real-${days}d`, m);
    expect(m.columns).toBe(2);
    expect(m.scrollRoot!.scrollHeight).toBeLessThanOrEqual(m.scrollRoot!.clientHeight);
    expectCommonTruth(m, 'light');
    await page.screenshot({ path: test.info().outputPath(`gh1231-1440x720-real-${days}d.png`) });
  }
});
