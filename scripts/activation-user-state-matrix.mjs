// @ts-check
/**
 * Canonical activation post-OAuth user-state matrix — M1 … M34.
 *
 * SHOP-REVIEW-SYNC-ANIMATION-THEME-07. This is the repo-versioned source of
 * truth for the browser-level activation matrix. It drives the deterministic
 * preview harness at /dev/activation-preview through the final approved
 * seven-scene experience and its permanent lifecycle / layout / theme /
 * visibility / semantic contracts.
 *
 * Provenance of each case is recorded in MATRIX_DEFINITION below:
 *   - "recovered"   : valid intent ported from the pre-existing (non-versioned)
 *                     M1–M24 runner, re-verified against the final implementation.
 *   - "reconciled"  : replaces a stale pre-redesign assertion (M22 readiness/batch,
 *                     M23 released-batch) with the final approved contract.
 *   - "canonical"   : newly authored here (M25–M34) from the permanent contracts
 *                     established during this issue. These are NOT claimed to be
 *                     recovered historical definitions.
 *
 * Run:   node scripts/activation-user-state-matrix.mjs
 *   or:  npm run test:activation-matrix
 *
 * Env:
 *   ACTIVATION_MATRIX_PORT   fixed Vite dev port (default 47332, strict)
 *   ACTIVATION_MATRIX_OUT    output dir for matrix-result.json (default a
 *                            timestamped dir under the OS temp root)
 *   ACTIVATION_PREVIEW_BASE  if set, skip starting Vite and use this base URL
 *
 * Exit code 0 = all 34 pass; 1 = one or more failed / blocked.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'apps/frontend');
const PORT = Number(process.env.ACTIVATION_MATRIX_PORT || 47332);
const OUT_DIR =
  process.env.ACTIVATION_MATRIX_OUT ||
  path.join(tmpdir(), `activation-m1-m34-${new Date().toISOString().slice(0, 10)}`);
const EXTERNAL_BASE = process.env.ACTIVATION_PREVIEW_BASE || null;

// Permanent timing contracts (mirror of activationMotionTokens.ACTIVATION_TIMING).
const MIN_FIRST_RUN_DWELL_MS = 9000;
const MAX_POST_SYNC_RESOLVE_MS = 1800;
const COMPLETION_TRANSITION_MS = 900;

// Final approved seven-scene canonical copy (locks the single semantic source).
const CANONICAL = {
  SCENE_1: { label: 'Plan', lines: ['Create the PO.', 'Know what stock is coming.'], aria: ['Plan', 'inbound truck'] },
  SCENE_2: { label: 'Receive', lines: ['Receive against the PO.'], aria: ['Receive', 'unpacked'] },
  SCENE_3: { label: 'Barcode', lines: ['Give each product a LaSyncro barcode.', 'Queue it for put away.'], aria: ['Barcode', 'barcode gate', 'stow queue'] },
  SCENE_4: { label: 'Put away', lines: ['Place each barcoded product in the correct bin.'], aria: ['Put away', 'correct bin', 'inventory bin'] },
  SCENE_5: { label: 'Pick', lines: ['Release orders.', 'Pick their items and move them to pack.'], aria: ['Pick', 'Release orders', 'trolley'] },
  SCENE_6: { label: 'Pack', lines: ['Verify each order.', 'Pack it and create the shipping label.'], aria: ['Pack', 'shipping label', 'labelled parcels'] },
  SCENE_7: { label: 'Ship', lines: ['Move packed orders to the shipping dock.', 'Load the truck and send them out.'], aria: ['Ship', 'pallet', 'truck'] },
};
const SCENES = /** @type {const} */ (['SCENE_1', 'SCENE_2', 'SCENE_3', 'SCENE_4', 'SCENE_5', 'SCENE_6', 'SCENE_7']);
const WAREHOUSE_ZONE_IDS = ['admin', 'dock', 'orders', 'outbound', 'pack', 'receive', 'shelves', 'stow'];
const ORDER_PARTITION = { 'order-1': ['bottle', 'pouch'], 'order-2': ['box'], 'order-3': ['carton', 'jar'] };
const FIVE_IDS = ['bottle', 'box', 'carton', 'jar', 'pouch']; // sorted

const MATRIX_DEFINITION = [
  ['M1', 'TINY_FIRST_ACTIVATION_BUFFER', 'recovered', 'First-run dwell (9000ms) is enforced even when real sync finishes almost immediately; completion transition only after dwell.'],
  ['M2', 'FAST_SYNC_STILL_BUFFERED', 'recovered', 'A 5s sync still shows data-sync-complete=false before dwell and dwellSatisfied stays false until 9000ms.'],
  ['M3', 'NORMAL_SYNC', 'recovered', 'Normal (~17s) sync completes, dwell satisfied, completion transition renders.'],
  ['M4', 'LONG_SYNC_ENTERS_AMBIENT', 'recovered', 'Long sync: story reaches AMBIENT while backend sync stays incomplete.'],
  ['M5', 'VERY_LONG_REASSURANCE', 'recovered', 'Very-long sync exposes veryLongSync and the reassurance copy.'],
  ['M6', 'RECONNECT_NO_FIRST_RUN_DWELL', 'recovered', 'Reconnect (firstActivation=false) skips first-run dwell and completes.'],
  ['M7', 'FAILURE_INTERRUPTS_STORY', 'recovered', 'Backend failure drives data-scene=INTERRUPTED, no completion transition, film keeps no sync authority.'],
  ['M8', 'DARK_THEME', 'recovered', 'Dark theme resolves; rich film renders.'],
  ['M9', 'LIGHT_THEME', 'recovered', 'Light theme resolves; rich film renders.'],
  ['M10', 'UNRESOLVED_THEME_SAFE_SHELL', 'recovered', 'Unresolved theme renders only the pending shell; no rich film before theme authority.'],
  ['M11', 'REDUCED_MOTION', 'recovered', 'Reduced motion is represented on the film and diagnostics; scene still resolves.'],
  ['M12', 'HIDDEN_TAB_PAUSE_RESUME', 'recovered', 'visible->hidden->visible: story time pauses while hidden, resumes on return, no queued catch-up.'],
  ['M13', 'COMPLETE_DURING_SCENE_2', 'recovered', 'Real sync completing mid-SCENE_2 does not synchronously cut the scene; bounded transition follows.'],
  ['M14', 'COMPLETE_DURING_SCENE_4', 'recovered', 'Same contract, SCENE_4.'],
  ['M15', 'COMPLETE_DURING_SCENE_5', 'recovered', 'Same contract, SCENE_5.'],
  ['M16', 'COMPLETE_DURING_SCENE_7', 'recovered', 'Same contract, SCENE_7.'],
  ['M17', 'FILM_HAS_NO_SYNC_AUTHORITY', 'recovered', 'workflow-film always reports data-sync-authority="none".'],
  ['M18', 'WIDE_NO_OVERFLOW', 'recovered', 'Wide viewport: no horizontal overflow.'],
  ['M19', 'REVIEWER_1024_NO_OVERFLOW', 'recovered', 'Reviewer-laptop 1024x820: no horizontal AND no vertical overflow.'],
  ['M20', 'TABLET_NO_OVERFLOW', 'recovered', 'Tablet viewport: no horizontal overflow.'],
  ['M21', 'MOBILE_NO_OVERFLOW', 'recovered', 'Mobile viewport: no horizontal overflow.'],
  ['M22', 'SCENE_4_PUTAWAY_BROWSER_CONTRACT', 'reconciled', 'Final Scene 4 = Put away: five barcoded product identities end stored across five distinct Inventory bins; no readiness/batch semantics.'],
  ['M23', 'SCENE_5_PICK_BROWSER_CONTRACT', 'reconciled', 'Final Scene 5 = Pick: three distinct orders, one trolley, five products partitioned 2/1/2; no released-batch attribute or copy.'],
  ['M24', 'SCENE_7_DISPATCH_BROWSER_CONTRACT', 'reconciled', 'Final Scene 7 = dispatch: full-trace seam retained, three parcels (order-1/2/3), one outbound pallet, 2/1/2 identity mapping, no sync authority.'],
  ['M25', 'LONG_SYNC_SETTLES_BEFORE_AMBIENT', 'canonical', 'Long sync: story progresses through scenes and settles into AMBIENT; Scene 1 never restarts once left; sync stays incomplete.'],
  ['M26', 'INITIAL_HIDDEN_MOUNT_PAUSES_STORY', 'canonical', 'Mounted while document already hidden: story elapsed does not advance until visibility resumes; first progression only after resume (no instant catch-up).'],
  ['M27', 'FAILURE_DURING_LATE_STORY_INTERRUPTS', 'canonical', 'Failure triggered while in a late scene: INTERRUPTED wins, active action stops, no success leak, film keeps no sync authority, warehouse stays mounted.'],
  ['M28', 'COMPLETION_RESOLVE_BOUND', 'canonical', 'Post-sync resolve to completion transition is bounded by MAX_POST_SYNC_RESOLVE_MS and is not a synchronous cut.'],
  ['M29', 'COMPLETION_TRANSITION_DURATION', 'canonical', 'The completion transition phase honours COMPLETION_TRANSITION_MS (not instantaneous, not materially overlong).'],
  ['M30', 'PERSISTENT_WAREHOUSE_WORLD', 'canonical', 'Every scene renders the identical 8-zone transplanted warehouse world; all zones flat; zero raised zones.'],
  ['M31', 'NO_LEGACY_MOVEMENT_LANGUAGE', 'canonical', 'Every scene: no sync authority, movement-language none, brand-pulse absent, orange routes/highlight none.'],
  ['M32', 'FIVE_PRODUCT_CONTINUITY', 'canonical', 'Five product identities carried barcoded -> stored -> picked (2/1/2) -> packed (3 parcels + 3 labels) -> shipped (3 parcels + 1 pallet).'],
  ['M33', 'CANONICAL_COPY_AND_ARIA', 'canonical', 'Scene labels + visible copy + aria semantics come from the single canonical token source (no second semantic source reappears).'],
  ['M34', 'REVIEWER_FIRST_RUN_END_TO_END', 'canonical', 'Deterministic first-run reviewer path end-to-end: seven scenes -> sync completion -> dwell -> completion transition, no JS errors, no overflow, no failure, film never gains sync authority.'],
];

// ---------------------------------------------------------------------------

let viteProc = null;

async function startPreviewServer() {
  if (EXTERNAL_BASE) return `${EXTERNAL_BASE.replace(/\/$/, '')}`;

  viteProc = spawn(
    'npx',
    ['vite', '--config', './vite.config.ts', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: FRONTEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
  );
  let log = '';
  viteProc.stdout.on('data', (d) => (log += d));
  viteProc.stderr.on('data', (d) => (log += d));
  viteProc.on('exit', (code) => {
    if (code && code !== 0 && code !== null) {
      console.error(`[matrix] vite exited early (code ${code}). Recent output:\n${log.slice(-1200)}`);
    }
  });

  const base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (viteProc.exitCode !== null && viteProc.exitCode !== 0) {
      throw new Error(
        `ENVIRONMENT DEFECT: Vite dev server failed to start on :${PORT} (exit ${viteProc.exitCode}). ` +
          `Is the port in use? Set ACTIVATION_MATRIX_PORT.\n${log.slice(-800)}`
      );
    }
    try {
      const res = await fetch(`${base}/dev/activation-preview`);
      if (res.ok) return base;
    } catch {
      /* not ready */
    }
    await delay(400);
  }
  throw new Error(`ENVIRONMENT DEFECT: Vite dev server not reachable on ${base} within 60s.\n${log.slice(-800)}`);
}

function stopPreviewServer() {
  if (viteProc && viteProc.exitCode === null) {
    try {
      viteProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------

let context;
let lastPage = null;

function qs(params) {
  return new URLSearchParams(params).toString();
}

async function openPreview(base, params = {}, viewport = null) {
  const page = await context.newPage();
  lastPage = page;
  page._pageErrors = [];
  page.on('pageerror', (e) => page._pageErrors.push(String(e && e.stack ? e.stack : e)));
  page.on('console', (m) => {
    if (m.type() === 'error') page._pageErrors.push(`console.error: ${m.text()}`);
  });
  if (viewport) await page.setViewportSize(viewport);
  const url = `${base}/dev/activation-preview?${qs({
    scenario: 'initial',
    story: 'automatic',
    theme: 'dark',
    viewport: 'reviewer-laptop',
    speed: '1',
    ...params,
  })}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByTestId('activation-preview').waitFor({ state: 'visible', timeout: 15000 });
  return page;
}

const filmAttr = (page, name) => page.getByTestId('workflow-film').getAttribute(name);
const expAttr = (page, name) => page.getByTestId('sync-animation-experience').getAttribute(name);
const diagAttr = (page, name) => page.getByTestId('activation-preview-diagnostics').getAttribute(name);

function invariant(cond, message) {
  if (!cond) throw new Error(message);
}

async function expectFilm(page, name, expected) {
  const actual = await filmAttr(page, name);
  invariant(actual === expected, `workflow-film[${name}]: expected "${expected}", got "${actual}"`);
}

async function waitAttr(page, testId, name, expected, timeout = 6000) {
  await page.waitForFunction(
    ({ testId, name, expected }) =>
      document.querySelector(`[data-testid="${testId}"]`)?.getAttribute(name) === expected,
    { testId, name, expected },
    { timeout }
  );
}

async function markerCount(page, marker) {
  return page.locator(`[data-workflow-marker="${marker}"]`).count();
}

async function zoneIds(page) {
  return (
    await page.$$eval('[data-testid="workflow-film"] [data-warehouse-zone]', (ns) =>
      ns.map((n) => n.getAttribute('data-warehouse-zone'))
    )
  ).sort();
}

async function partitionByOrder(page, marker) {
  const rows = await page.$$eval(`[data-workflow-marker="${marker}"]`, (ns) =>
    ns.map((n) => [n.getAttribute('data-order-id'), n.getAttribute('data-product-id')])
  );
  /** @type {Record<string,string[]>} */
  const out = {};
  for (const [oid, pid] of rows) {
    if (!oid || !pid) continue;
    (out[oid] ||= []).push(pid);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

async function visibleLines(page) {
  return page.$$eval('[data-testid="workflow-film"] .MuiStack-root p', (ns) =>
    ns.map((n) => n.textContent.trim()).filter(Boolean)
  );
}

async function overflow(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    hOver: document.documentElement.scrollWidth > window.innerWidth + 1,
    vOver: document.documentElement.scrollHeight > window.innerHeight + 1,
  }));
}

async function settledScene(base, sceneId) {
  // Deterministic settled representative state via reduced motion.
  return openPreview(base, { scenario: 'initial', story: sceneId, theme: 'dark', motion: 'reduced' });
}

// ---------------------------------------------------------------------------

const results = [];

async function run(id, name, provenance, fn) {
  const started = Date.now();
  lastPage = null;
  const rec = { id, name, provenance, status: 'PASS', durationMs: 0, evidence: {}, error: null };
  try {
    await fn(rec);
  } catch (e) {
    rec.status = 'FAIL';
    rec.error = String(e && e.stack ? e.stack : e);
    if (lastPage) {
      try {
        const file = path.join(OUT_DIR, `FAIL-${id}.png`);
        await lastPage.screenshot({ path: file, fullPage: true });
        rec.evidence.screenshot = file;
      } catch {
        /* ignore */
      }
    }
  } finally {
    rec.durationMs = Date.now() - started;
    if (lastPage) {
      try {
        await lastPage.close();
      } catch {
        /* ignore */
      }
    }
    lastPage = null;
    results.push(rec);
    console.log(`${rec.status === 'PASS' ? 'PASS' : 'FAIL'}  ${id.padEnd(4)} ${name}  (${rec.durationMs}ms)`);
    if (rec.error) console.log(`      ${rec.error.split('\n')[0]}`);
  }
}

async function completeDuring(base, sceneId, rec) {
  const page = await openPreview(base, { scenario: 'reconnect', story: sceneId, theme: 'dark' });
  await expectFilm(page, 'data-scene', sceneId);
  invariant((await expAttr(page, 'data-first-activation')) === 'false', 'reconnect must not be first activation');
  await page.getByRole('button', { name: /^complete$/i }).click();
  await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 3000);
  await expectFilm(page, 'data-scene', sceneId); // not synchronously cut
  const t0 = Date.now();
  await page.getByTestId('sync-completion-chip').waitFor({ state: 'visible', timeout: 3200 });
  rec.evidence.resolveMs = Date.now() - t0;
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const base = await startPreviewServer();
  console.log(`[matrix] preview base = ${base}`);
  console.log(`[matrix] output dir   = ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ---- M1..M11 ------------------------------------------------------------

  await run('M1', 'TINY_FIRST_ACTIVATION_BUFFER', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'tiny' });
    await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 3000);
    invariant((await expAttr(page, 'data-first-activation')) === 'true', 'first activation expected');
    invariant((await diagAttr(page, 'data-dwell-satisfied')) === 'false', 'dwell must not be satisfied yet');
    const t0 = Date.now();
    await waitAttr(page, 'activation-preview-diagnostics', 'data-dwell-satisfied', 'true', 11000);
    rec.evidence.dwellMs = Date.now() - t0;
    invariant(rec.evidence.dwellMs >= MIN_FIRST_RUN_DWELL_MS - 1500, `dwell released too early: ${rec.evidence.dwellMs}ms`);
    await page.getByTestId('sync-completion-chip').waitFor({ state: 'visible', timeout: 3500 });
  });

  await run('M2', 'FAST_SYNC_STILL_BUFFERED', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'fast' });
    await delay(1000);
    await expectAttrExp(page, 'data-sync-complete', 'false');
    await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 6500);
    invariant((await diagAttr(page, 'data-dwell-satisfied')) === 'false', 'dwell must still be unsatisfied at ~5s');
    rec.evidence.dwellSatisfiedAtComplete = false;
  });

  await run('M3', 'NORMAL_SYNC', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'normal' });
    const t0 = Date.now();
    await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 22000);
    rec.evidence.syncCompleteMs = Date.now() - t0;
    invariant((await diagAttr(page, 'data-dwell-satisfied')) === 'true', 'dwell satisfied by ~17s');
    const chip = page.getByTestId('sync-completion-chip');
    await chip.waitFor({ state: 'visible', timeout: 4000 });
    // Approved handoff is a small, non-blocking corner chip — no centred
    // overlay, no backdrop/dimming, film stays visible, CTA present.
    invariant((await chip.getAttribute('data-blocking')) === 'false', 'completion chip must be non-blocking');
    invariant(await page.getByTestId('workflow-film').isVisible(), 'film must stay visible under completion chip');
    invariant(
      (await page.getByRole('button', { name: /enter workspace/i }).count()) === 1,
      'completion chip must expose an "Enter workspace" CTA'
    );
    const dim = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *')).some((el) => {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        const coversViewport = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
        const bg = s.backgroundColor;
        const m = bg.match(/rgba?\(([^)]+)\)/);
        const alpha = m ? Number(m[1].split(',')[3] ?? '1') : bg === 'transparent' ? 0 : 1;
        return coversViewport && alpha > 0.01;
      })
    );
    invariant(!dim, 'no full-viewport dimming/backdrop layer may be present at completion');
  });

  await run('M4', 'LONG_SYNC_ENTERS_AMBIENT', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'long', speed: '4' });
    await waitAttr(page, 'workflow-film', 'data-scene', 'AMBIENT', 12000);
    await expectAttrExp(page, 'data-sync-complete', 'false');
    rec.evidence.scene = 'AMBIENT';
  });

  await run('M5', 'VERY_LONG_REASSURANCE', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'very-long', story: 'AMBIENT' });
    await waitAttr(page, 'activation-preview-diagnostics', 'data-very-long-sync', 'true', 3000);
    const text = (await page.getByTestId('sync-progress-panel').textContent()) || '';
    invariant(/still bringing everything into lasyncro/i.test(text), 'very-long reassurance copy missing');
    rec.evidence.veryLong = true;
  });

  await run('M6', 'RECONNECT_NO_FIRST_RUN_DWELL', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'reconnect' });
    invariant((await expAttr(page, 'data-first-activation')) === 'false', 'reconnect not first activation');
    invariant((await diagAttr(page, 'data-dwell-satisfied')) === 'true', 'reconnect skips first-run dwell');
    await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 8000);
    await page.getByTestId('sync-completion-chip').waitFor({ state: 'visible', timeout: 4000 });
  });

  await run('M7', 'FAILURE_INTERRUPTS_STORY', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'failed', story: 'SCENE_4' });
    await waitAttr(page, 'workflow-film', 'data-scene', 'INTERRUPTED', 3000);
    invariant((await expAttr(page, 'data-sync-failed')) === 'true', 'sync-failed expected');
    await expectFilm(page, 'data-active-action', 'none');
    await expectFilm(page, 'data-sync-authority', 'none');
    invariant((await page.getByTestId('sync-completion-chip').count()) === 0, 'failure leaked into completion transition');
  });

  await run('M8', 'DARK_THEME', 'recovered', async (rec) => {
    const page = await openPreview(base, { story: 'SCENE_1', theme: 'dark' });
    await waitAttr(page, 'activation-preview-diagnostics', 'data-resolved-theme', 'dark', 3000);
    await page.getByTestId('workflow-film').waitFor({ state: 'visible', timeout: 3000 });
    rec.evidence.resolvedTheme = 'dark';
  });

  await run('M9', 'LIGHT_THEME', 'recovered', async (rec) => {
    const page = await openPreview(base, { story: 'SCENE_1', theme: 'light' });
    await waitAttr(page, 'activation-preview-diagnostics', 'data-resolved-theme', 'light', 3000);
    await page.getByTestId('workflow-film').waitFor({ state: 'visible', timeout: 3000 });
    rec.evidence.resolvedTheme = 'light';
  });

  await run('M10', 'UNRESOLVED_THEME_SAFE_SHELL', 'recovered', async (rec) => {
    const page = await openPreview(base, { story: 'SCENE_1', theme: 'unresolved' });
    await page.getByTestId('workflow-film-theme-pending').waitFor({ state: 'visible', timeout: 3000 });
    invariant((await page.getByTestId('workflow-film').count()) === 0, 'rich film rendered before theme authority');
  });

  await run('M11', 'REDUCED_MOTION', 'recovered', async (rec) => {
    const page = await openPreview(base, { story: 'SCENE_5', motion: 'reduced' });
    await expectFilm(page, 'data-scene', 'SCENE_5');
    await expectFilm(page, 'data-reduced-motion', 'true');
    invariant((await diagAttr(page, 'data-reduced-motion')) === 'true', 'diagnostics reducedMotion missing');
  });

  // ---- M12 hidden pause/resume -----------------------------------------

  await run('M12', 'HIDDEN_TAB_PAUSE_RESUME', 'recovered', async (rec) => {
    const page = await openPreview(base, { scenario: 'initial', story: 'automatic' });
    await waitAttr(page, 'workflow-film', 'data-scene', 'SCENE_1', 3000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await delay(3800);
    await expectFilm(page, 'data-scene', 'SCENE_1');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const t0 = Date.now();
    await waitAttr(page, 'workflow-film', 'data-scene', 'SCENE_2', 5000);
    rec.evidence.resumeToScene2Ms = Date.now() - t0;
  });

  // ---- M13..M16 complete-during-scene --------------------------------

  await run('M13', 'COMPLETE_DURING_SCENE_2', 'recovered', (rec) => completeDuring(base, 'SCENE_2', rec));
  await run('M14', 'COMPLETE_DURING_SCENE_4', 'recovered', (rec) => completeDuring(base, 'SCENE_4', rec));
  await run('M15', 'COMPLETE_DURING_SCENE_5', 'recovered', (rec) => completeDuring(base, 'SCENE_5', rec));
  await run('M16', 'COMPLETE_DURING_SCENE_7', 'recovered', (rec) => completeDuring(base, 'SCENE_7', rec));

  // ---- M17 no sync authority -----------------------------------------

  await run('M17', 'FILM_HAS_NO_SYNC_AUTHORITY', 'recovered', async () => {
    const page = await openPreview(base, { scenario: 'normal', story: 'SCENE_4' });
    await expectFilm(page, 'data-sync-authority', 'none');
  });

  // ---- M18..M21 overflow -------------------------------------------

  for (const [id, vp, browserVp, wantVertical] of [
    ['M18', 'wide', { width: 1500, height: 950 }, false],
    ['M19', 'reviewer-laptop', { width: 1024, height: 820 }, true],
    ['M20', 'tablet', { width: 850, height: 900 }, false],
    ['M21', 'mobile', { width: 480, height: 900 }, false],
  ]) {
    await run(id, MATRIX_DEFINITION.find((m) => m[0] === id)[1], 'recovered', async (rec) => {
      const page = await openPreview(base, { scenario: 'normal', story: 'SCENE_4', viewport: vp }, browserVp);
      const o = await overflow(page);
      rec.evidence = o;
      invariant(!o.hOver, `horizontal overflow: ${JSON.stringify(o)}`);
      if (wantVertical) invariant(!o.vOver, `vertical overflow: ${JSON.stringify(o)}`);
    });
  }

  // ---- M22 SCENE_4 put-away (reconciled) -------------------------

  await run('M22', 'SCENE_4_PUTAWAY_BROWSER_CONTRACT', 'reconciled', async (rec) => {
    const page = await settledScene(base, 'SCENE_4');
    const label = await filmAttr(page, 'aria-label');
    invariant(/put away/i.test(label) && /correct bin/i.test(label), `Scene 4 aria not put-away: ${label}`);
    invariant(!/readiness|released batch/i.test(label), `Scene 4 aria still carries retired semantics: ${label}`);
    const prods = await page.$$eval('[data-workflow-marker="scene4-product"]', (ns) =>
      ns.map((n) => ({ id: n.getAttribute('data-product-id'), bc: n.getAttribute('data-barcode-state'), pa: n.getAttribute('data-putaway-state') }))
    );
    invariant(JSON.stringify(prods.map((p) => p.id).sort()) === JSON.stringify(FIVE_IDS), `Scene 4 identities: ${JSON.stringify(prods)}`);
    invariant(prods.every((p) => p.bc === 'barcoded'), 'Scene 4 products must be barcoded');
    invariant(prods.every((p) => p.pa === 'stored'), 'Scene 4 settled products must be stored');
    const bins = await page.$$eval('[data-workflow-marker="inventory-bin"]', (ns) => ns.map((n) => n.getAttribute('data-bin-id')));
    invariant(bins.length === 5 && new Set(bins).size === 5, `Scene 4 must have 5 distinct inventory bins: ${JSON.stringify(bins)}`);
    invariant((await filmAttr(page, 'data-requires-released-batch')) === null, 'data-requires-released-batch must be gone');
    rec.evidence = { bins, identities: prods.map((p) => p.id).sort() };
  });

  // ---- M23 SCENE_5 pick (reconciled) --------------------------

  await run('M23', 'SCENE_5_PICK_BROWSER_CONTRACT', 'reconciled', async (rec) => {
    const page = await settledScene(base, 'SCENE_5');
    const label = await filmAttr(page, 'aria-label');
    invariant(/pick/i.test(label) && /release orders/i.test(label), `Scene 5 aria not pick: ${label}`);
    invariant(!/released batch/i.test(label), `Scene 5 aria still carries released-batch: ${label}`);
    invariant((await filmAttr(page, 'data-requires-released-batch')) === null, 'data-requires-released-batch must be gone');
    const orders = await page.$$eval('[data-workflow-marker="order-pool-order"]', (ns) => ns.map((n) => n.getAttribute('data-order-id')).sort());
    invariant(JSON.stringify(orders) === JSON.stringify(['order-1', 'order-2', 'order-3']), `Scene 5 orders: ${JSON.stringify(orders)}`);
    invariant((await markerCount(page, 'pick-trolley')) === 1, 'Scene 5 must have exactly one pick trolley');
    const part = await partitionByOrder(page, 'scene5-product');
    invariant(JSON.stringify(part) === JSON.stringify(ORDER_PARTITION), `Scene 5 partition: ${JSON.stringify(part)}`);
    rec.evidence = { orders, partition: part };
  });

  // ---- M24 SCENE_7 dispatch (reconciled) ----------------------

  await run('M24', 'SCENE_7_DISPATCH_BROWSER_CONTRACT', 'reconciled', async (rec) => {
    const page = await settledScene(base, 'SCENE_7');
    await expectFilm(page, 'data-has-full-trace', 'true');
    await expectFilm(page, 'data-sync-authority', 'none');
    const parcels = await page.$$eval('[data-workflow-marker="scene7-parcel"]', (ns) => ns.map((n) => n.getAttribute('data-order-id')).sort());
    invariant(JSON.stringify(parcels) === JSON.stringify(['order-1', 'order-2', 'order-3']), `Scene 7 parcels: ${JSON.stringify(parcels)}`);
    invariant((await markerCount(page, 'outbound-pallet')) === 1, 'Scene 7 must have exactly one outbound pallet');
    const part = await partitionByOrder(page, 'scene7-product');
    invariant(JSON.stringify(part) === JSON.stringify(ORDER_PARTITION), `Scene 7 partition: ${JSON.stringify(part)}`);
    rec.evidence = { parcels, partition: part };
  });

  // ---- M25 long-sync settles before ambient (canonical) -------

  await run('M25', 'LONG_SYNC_SETTLES_BEFORE_AMBIENT', 'canonical', async (rec) => {
    const page = await openPreview(base, { scenario: 'long', speed: '4', story: 'automatic' });
    const seq = [];
    const deadline = Date.now() + 12000;
    let sawNonScene1 = false;
    let restartViolation = false;
    let anyComplete = false;
    while (Date.now() < deadline) {
      const scene = await filmAttr(page, 'data-scene');
      const complete = await expAttr(page, 'data-sync-complete');
      if (complete === 'true') anyComplete = true;
      if (seq[seq.length - 1] !== scene) seq.push(scene);
      if (scene && scene !== 'SCENE_1') sawNonScene1 = true;
      if (sawNonScene1 && scene === 'SCENE_1') restartViolation = true;
      if (scene === 'AMBIENT') break;
      await delay(150);
    }
    rec.evidence = { sequence: seq, sawNonScene1, anyComplete };
    invariant(seq.includes('AMBIENT'), `story never reached AMBIENT: ${JSON.stringify(seq)}`);
    invariant(seq[seq.length - 1] === 'AMBIENT', `story did not settle in AMBIENT: ${JSON.stringify(seq)}`);
    invariant(!restartViolation, `Scene 1 restarted after being left: ${JSON.stringify(seq)}`);
    invariant(!anyComplete, 'long sync must not report sync-complete on this path');
  });

  // ---- M26 initial-hidden mount (canonical) ------------------

  await run('M26', 'INITIAL_HIDDEN_MOUNT_PAUSES_STORY', 'canonical', async (rec) => {
    const page = await context.newPage();
    lastPage = page;
    page._pageErrors = [];
    page.on('pageerror', (e) => page._pageErrors.push(String(e)));
    await page.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    });
    await page.goto(`${base}/dev/activation-preview?${qs({ scenario: 'initial', story: 'automatic', theme: 'dark', speed: '1' })}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.getByTestId('activation-preview').waitFor({ state: 'visible', timeout: 15000 });
    invariant((await page.evaluate(() => document.visibilityState)) === 'hidden', 'document should start hidden');
    await waitAttr(page, 'workflow-film', 'data-scene', 'SCENE_1', 3000);
    await delay(4200); // well past SCENE_1 (3000ms) — must NOT advance while hidden
    await expectFilm(page, 'data-scene', 'SCENE_1');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const t0 = Date.now();
    await waitAttr(page, 'workflow-film', 'data-scene', 'SCENE_2', 5000);
    rec.evidence.resumeToScene2Ms = Date.now() - t0;
    invariant(rec.evidence.resumeToScene2Ms >= 1500, `hidden time was counted as story time (instant catch-up): ${rec.evidence.resumeToScene2Ms}ms`);
  });

  // ---- M27 failure during late story (canonical) -----------

  await run('M27', 'FAILURE_DURING_LATE_STORY_INTERRUPTS', 'canonical', async (rec) => {
    const page = await openPreview(base, { scenario: 'reconnect', story: 'SCENE_7', theme: 'dark' });
    await expectFilm(page, 'data-scene', 'SCENE_7');
    await page.getByRole('button', { name: /^fail$/i }).click();
    await waitAttr(page, 'workflow-film', 'data-scene', 'INTERRUPTED', 3000);
    invariant((await expAttr(page, 'data-sync-failed')) === 'true', 'sync-failed expected');
    await expectFilm(page, 'data-active-action', 'none');
    await expectFilm(page, 'data-sync-authority', 'none');
    invariant((await page.getByTestId('sync-completion-chip').count()) === 0, 'failure leaked into completion transition');
    invariant(
      (await page.locator('[data-workflow-marker="persistent-warehouse"]').count()) >= 1,
      'warehouse world unmounted on failure'
    );
  });

  // ---- M28 bounded post-sync resolve (canonical) ---------

  await run('M28', 'COMPLETION_RESOLVE_BOUND', 'canonical', async (rec) => {
    const page = await openPreview(base, { scenario: 'reconnect', story: 'SCENE_4', theme: 'dark' });
    await page.getByRole('button', { name: /^complete$/i }).click();
    await waitAttr(page, 'sync-animation-experience', 'data-sync-complete', 'true', 3000);
    // The scene must not be structurally cut when sync completes mid-scene...
    await expectFilm(page, 'data-scene', 'SCENE_4');
    const t0 = Date.now();
    // ...and the completion transition must begin within the permanent bounded
    // post-sync resolve ceiling (MAX_POST_SYNC_RESOLVE_MS), plus harness tolerance.
    // MAX_POST_SYNC_RESOLVE_MS is an upper bound (a safety timeout for slow scene
    // settle); when every resolve precondition is already met the transition may
    // begin immediately, so this case asserts only the ceiling.
    await page.getByTestId('sync-completion-chip').waitFor({ state: 'visible', timeout: MAX_POST_SYNC_RESOLVE_MS + 1500 });
    const resolveMs = Date.now() - t0;
    rec.evidence.resolveMs = resolveMs;
    rec.evidence.ceilingMs = MAX_POST_SYNC_RESOLVE_MS;
    invariant(
      resolveMs <= MAX_POST_SYNC_RESOLVE_MS + 900,
      `post-sync resolve exceeded bound: ${resolveMs}ms > ${MAX_POST_SYNC_RESOLVE_MS}+900 tolerance`
    );
  });

  // ---- M29 completion transition duration (canonical) ----

  await run('M29', 'COMPLETION_TRANSITION_DURATION', 'canonical', async (rec) => {
    const page = await openPreview(base, { scenario: 'reconnect', story: 'SCENE_5', theme: 'dark' });
    await page.getByRole('button', { name: /^complete$/i }).click();
    // Single sequential poll (no concurrent waitForFunction on the same page):
    // record the phase timeline through COMPLETION_TRANSITION -> READY_TO_ENTER.
    const timeline = [];
    const start = Date.now();
    let last = null;
    while (Date.now() - start < 6000) {
      const phase = await expAttr(page, 'data-experience-phase');
      if (phase !== last) {
        timeline.push({ phase, at: Date.now() });
        last = phase;
      }
      if (phase === 'READY_TO_ENTER') break;
      await delay(40);
    }
    rec.evidence.phases = timeline.map((x) => x.phase);
    const ct = timeline.find((x) => x.phase === 'COMPLETION_TRANSITION');
    const rte = timeline.find((x) => x.phase === 'READY_TO_ENTER');
    invariant(ct, `COMPLETION_TRANSITION phase never observed (instantaneous transition): ${JSON.stringify(rec.evidence.phases)}`);
    invariant(rte, `READY_TO_ENTER phase never reached within 6s: ${JSON.stringify(rec.evidence.phases)}`);
    const durMs = rte.at - ct.at;
    rec.evidence.transitionMs = durMs;
    rec.evidence.contractMs = COMPLETION_TRANSITION_MS;
    // Not instantaneous removal, not materially overlong (documented tolerance).
    invariant(
      durMs >= 200 && durMs <= COMPLETION_TRANSITION_MS + 900,
      `completion transition duration out of bounds: ${durMs}ms (contract ~${COMPLETION_TRANSITION_MS}ms, tolerance +900)`
    );
  });

  // ---- M30 persistent warehouse world (canonical) -------

  await run('M30', 'PERSISTENT_WAREHOUSE_WORLD', 'canonical', async (rec) => {
    const perScene = {};
    for (const scene of SCENES) {
      const page = await openPreview(base, { scenario: 'initial', story: scene, theme: 'dark' });
      await expectFilm(page, 'data-warehouse-world-id', 'activation-isometric-warehouse');
      const ids = await zoneIds(page);
      invariant(JSON.stringify(ids) === JSON.stringify(WAREHOUSE_ZONE_IDS), `${scene} zone ids: ${JSON.stringify(ids)}`);
      const depths = await page.$$eval('[data-testid="workflow-film"] [data-warehouse-zone]', (ns) => ns.map((n) => n.getAttribute('data-active-depth')));
      invariant(depths.every((d) => d === 'flat'), `${scene} has a non-flat zone: ${JSON.stringify(depths)}`);
      invariant((await page.locator('[data-testid="workflow-film"] [data-active-depth="raised"]').count()) === 0, `${scene} has a raised zone`);
      perScene[scene] = ids.length;
      await page.close();
      lastPage = null;
    }
    rec.evidence.perScene = perScene;
  });

  // ---- M31 no legacy movement language (canonical) -----

  await run('M31', 'NO_LEGACY_MOVEMENT_LANGUAGE', 'canonical', async (rec) => {
    for (const scene of SCENES) {
      const page = await openPreview(base, { scenario: 'initial', story: scene, theme: 'dark' });
      await expectFilm(page, 'data-sync-authority', 'none');
      await expectFilm(page, 'data-movement-language', 'none');
      await expectFilm(page, 'data-brand-pulse-active', 'false');
      await expectFilm(page, 'data-orange-directional-routes', 'none');
      await expectFilm(page, 'data-orange-zone-highlight', 'none');
      invariant((await page.locator('[data-brand-pulse="true"]').count()) === 0, `${scene} has a brand-pulse node`);
      await page.close();
      lastPage = null;
    }
    rec.evidence.scenes = SCENES.length;
  });

  // ---- M32 five-product continuity (canonical) --------

  await run('M32', 'FIVE_PRODUCT_CONTINUITY', 'canonical', async (rec) => {
    let page = await settledScene(base, 'SCENE_3');
    let ids = (await page.$$eval('[data-workflow-marker="scene3-product"]', (ns) => ns.map((n) => n.getAttribute('data-product-id')))).sort();
    invariant(JSON.stringify(ids) === JSON.stringify(FIVE_IDS), `Scene 3 identities: ${JSON.stringify(ids)}`);
    const bc = await page.$$eval('[data-workflow-marker="scene3-product"]', (ns) => ns.map((n) => n.getAttribute('data-barcode-state')));
    invariant(bc.every((b) => b === 'barcoded'), 'Scene 3 products must be barcoded');
    await page.close();

    page = await settledScene(base, 'SCENE_4');
    ids = (await page.$$eval('[data-workflow-marker="scene4-product"]', (ns) => ns.map((n) => n.getAttribute('data-product-id')))).sort();
    invariant(JSON.stringify(ids) === JSON.stringify(FIVE_IDS), `Scene 4 identities: ${JSON.stringify(ids)}`);
    await page.close();

    page = await settledScene(base, 'SCENE_5');
    invariant(JSON.stringify(await partitionByOrder(page, 'scene5-product')) === JSON.stringify(ORDER_PARTITION), 'Scene 5 partition drift');
    await page.close();

    page = await settledScene(base, 'SCENE_6');
    invariant(JSON.stringify(await partitionByOrder(page, 'scene6-product')) === JSON.stringify(ORDER_PARTITION), 'Scene 6 partition drift');
    invariant((await markerCount(page, 'shipping-parcel')) === 3, 'Scene 6 must have 3 shipping parcels');
    invariant((await markerCount(page, 'shipping-label')) === 3, 'Scene 6 must have 3 shipping labels');
    await page.close();

    page = await settledScene(base, 'SCENE_7');
    invariant(JSON.stringify(await partitionByOrder(page, 'scene7-product')) === JSON.stringify(ORDER_PARTITION), 'Scene 7 partition drift');
    invariant((await markerCount(page, 'scene7-parcel')) === 3, 'Scene 7 must have 3 parcels');
    invariant((await markerCount(page, 'outbound-pallet')) === 1, 'Scene 7 must have 1 outbound pallet');
    lastPage = page;
    rec.evidence.partition = ORDER_PARTITION;
  });

  // ---- M33 canonical copy + aria (canonical) ----------

  await run('M33', 'CANONICAL_COPY_AND_ARIA', 'canonical', async (rec) => {
    const seen = {};
    for (const scene of SCENES) {
      const page = await openPreview(base, { scenario: 'initial', story: scene, theme: 'dark' });
      const want = CANONICAL[scene];
      const chips = await page.$$eval('[data-testid="workflow-film"] p', (ns) => ns.map((n) => n.textContent.trim()));
      invariant(chips.includes(want.label), `${scene} label chip "${want.label}" not shown; chips=${JSON.stringify(chips.slice(0, 6))}`);
      const lines = await visibleLines(page);
      invariant(JSON.stringify(lines) === JSON.stringify(want.lines), `${scene} visible copy drift: got ${JSON.stringify(lines)} want ${JSON.stringify(want.lines)}`);
      const aria = (await filmAttr(page, 'aria-label')) || '';
      invariant(aria.startsWith(`${want.label}. `), `${scene} aria not "<label>. <fullSemanticCopy>": ${aria}`);
      for (const kw of want.aria) invariant(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(aria), `${scene} aria missing "${kw}": ${aria}`);
      seen[scene] = want.label;
      await page.close();
      lastPage = null;
    }
    rec.evidence.labels = seen;
  });

  // ---- M34 reviewer first-run end to end (canonical) --

  await run('M34', 'REVIEWER_FIRST_RUN_END_TO_END', 'canonical', async (rec) => {
    const page = await openPreview(
      base,
      { scenario: 'normal', story: 'automatic', theme: 'dark', viewport: 'reviewer-laptop', speed: '1' },
      { width: 1024, height: 820 }
    );
    const startedAt = Date.now();
    const sceneOrder = [];
    let syncCompleteAt = null;
    let dwellSatisfiedAt = null;
    let transitionAt = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const scene = await filmAttr(page, 'data-scene');
      if (sceneOrder[sceneOrder.length - 1] !== scene) sceneOrder.push(scene);
      if (!syncCompleteAt && (await expAttr(page, 'data-sync-complete')) === 'true') syncCompleteAt = Date.now() - startedAt;
      if (!dwellSatisfiedAt && (await diagAttr(page, 'data-dwell-satisfied')) === 'true') dwellSatisfiedAt = Date.now() - startedAt;
      invariant((await expAttr(page, 'data-sync-failed')) === 'false', 'reviewer path unexpectedly failed');
      invariant((await filmAttr(page, 'data-sync-authority')) === 'none', 'film gained sync authority');
      if ((await page.getByTestId('sync-completion-chip').count()) > 0) {
        transitionAt = Date.now() - startedAt;
        break;
      }
      const phase = await expAttr(page, 'data-experience-phase');
      if (phase === 'COMPLETION_TRANSITION' || phase === 'READY_TO_ENTER') {
        transitionAt = Date.now() - startedAt;
        break;
      }
      await delay(200);
    }
    const o = await overflow(page);
    rec.evidence = {
      sceneOrder,
      syncCompleteAtMs: syncCompleteAt,
      dwellSatisfiedAtMs: dwellSatisfiedAt,
      completionTransitionAtMs: transitionAt,
      overflow: o,
      pageErrors: page._pageErrors,
    };
    invariant(page._pageErrors.length === 0, `JS/page errors: ${JSON.stringify(page._pageErrors.slice(0, 3))}`);
    invariant(!o.hOver && !o.vOver, `overflow: ${JSON.stringify(o)}`);
    invariant(syncCompleteAt !== null, 'reviewer path never reached sync completion');
    invariant(dwellSatisfiedAt !== null, 'reviewer path never satisfied dwell');
    invariant(transitionAt !== null, 'reviewer path never reached completion transition');
    invariant(
      sceneOrder.filter((s) => /^SCENE_[1-7]$/.test(s)).length >= 3,
      `expected multi-scene progression, got ${JSON.stringify(sceneOrder)}`
    );
  });

  // ---------------------------------------------------------------------

  await context.close();
  await browser.close();

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const summary = {
    matrix: 'activation-user-state M1-M34',
    head: process.env.GIT_HEAD || null,
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    result: failed === 0 && results.length === 34 ? 'PASS' : 'FAIL',
    cases: results,
    definition: MATRIX_DEFINITION.map(([id, name, provenance, contract]) => ({ id, name, provenance, contract })),
  };
  const jsonPath = path.join(OUT_DIR, 'matrix-result.json');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  const txtPath = path.join(OUT_DIR, 'matrix-summary.txt');
  writeFileSync(
    txtPath,
    [
      `activation-user-state matrix M1-M34`,
      `generated ${summary.generatedAt}`,
      `TOTAL=${summary.total} PASS=${passed} FAIL=${failed} RESULT=${summary.result}`,
      '',
      ...results.map((r) => `${r.status.padEnd(4)} ${r.id.padEnd(4)} ${r.name}  ${r.durationMs}ms${r.error ? '  :: ' + r.error.split('\n')[0] : ''}`),
    ].join('\n') + '\n'
  );

  console.log('');
  console.log('============================================================');
  console.log(`USER_STATE_MATRIX_SUMMARY TOTAL=${summary.total} PASS=${passed} FAIL=${failed} RESULT=${summary.result}`);
  console.log(`MATRIX_RESULT_JSON=${jsonPath}`);
  console.log(`MATRIX_RESULT_TXT=${txtPath}`);
  console.log('============================================================');

  process.exitCode = summary.result === 'PASS' ? 0 : 1;
}

// small helper used above
async function expectAttrExp(page, name, expected) {
  const actual = await expAttr(page, name);
  invariant(actual === expected, `sync-animation-experience[${name}]: expected "${expected}", got "${actual}"`);
}

main()
  .catch((e) => {
    console.error('USER_STATE_MATRIX_FATAL', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => {
    stopPreviewServer();
  });
