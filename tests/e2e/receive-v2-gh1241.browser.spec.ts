// tests/e2e/receive-v2-gh1241.browser.spec.ts
//
// GH-1241 S3-C — real-browser certification of the complete Receive v2
// operator journey against the running local stack (Vite :5173 → API :3000 →
// local synchroflow_db). Every step is a real UI interaction; no application
// endpoint is mocked or called directly. Network traffic is only observed.
//
//   PO (Suppliers portal) → Mark as sent → Mark as arrived → Receive via WMS
//   (assign to the signed-in owner) → Open Receive → Start receiving (claim) →
//   count good units → Review → assign differences → Confirm and continue
//   (revision + finalization) → labels if required → Close → Stow handoff.
//
// Scenarios (dedicated new POs only; PO-1001/1005/1006 are never touched):
//   A  expected 3, good 1, missing 2          → stock +1, Stow 1
//   B  two barcode-less products (2 + 1)      → print + acknowledge both → close
//   C  expected 3, good 0 (None arrived)      → missing 3, no stock / LSU / Stow
//   D  expected 5, good 2, coming later 3     → stock +2, pending 3, partially_received
//
// Evidence: read-only SQL (BEGIN READ ONLY, restricted sf_app role, tenant 1)
// compared with a per-variant baseline taken before each PO is created.
// Browser label printing is verified as UI/API behaviour only (PDF request,
// explicit acknowledgement) — never as a physical label on a box.
//
// Credentials and DB connection come only from the environment; missing ones
// FAIL (a skip never certifies). Run with playwright.gh1241.config.ts.
//
// Artifacts (screens, evidence, traces) are written once per run under
// test-results/gh1241/runs/<run id>/ and refuse to overwrite an existing file.
// The only tolerated console error is the default unit_label printer lookup
// 404 of a print whose PDF fallback demonstrably opened.

import { test, expect, type Page, type Request, type Response } from '@playwright/test';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const EMAIL = process.env.LASYNCRO_E2E_EMAIL ?? '';
const PASSWORD = process.env.LASYNCRO_E2E_PASSWORD ?? '';
const SUPPLIER = 'Meridian Components';
const OPERATOR_NAME = /Owner Dev/;
const PROTECTED_PO_NUMBERS = [1001, 1005, 1006];
const RUN_ID = process.env.GH1241_RUN_ID ?? '';
const RUN_DIR = path.join('test-results', 'gh1241', 'runs', RUN_ID);
const PRINTER_LOOKUP_PATH = '/api/v1/wms/printers/default/unit_label';
const today = () => new Date().toISOString().slice(0, 10);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Read-only evidence connection ───────────────────────────────────────────

async function sql<T = Json>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({
    host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL app.current_tenant = '1'`);
    const result = await client.query(text, params as any[]);
    await client.query('ROLLBACK');
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

async function environmentGate() {
  if (!RUN_ID) throw new Error('GH1241_RUN_ID is required; run with playwright.gh1241.config.ts.');
  if (!EMAIL || !PASSWORD) throw new Error('LASYNCRO_E2E_EMAIL / LASYNCRO_E2E_PASSWORD are required; GH-1241 certification never skips.');
  const [identity] = await sql(`SELECT current_database() AS db, current_user AS role,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`);
  expect({ host: process.env.PGHOST, ...identity }).toEqual({ host: 'localhost', db: 'synchroflow_db', role: 'sf_app', superuser: false, bypassrls: false });
}

type VariantState = { onHand: number; inboundCount: number; inboundSum: number; lsus: number; stowTasks: number; problemTasks: number };

async function variantState(variantId: string): Promise<VariantState> {
  const [row] = await sql(`SELECT
      (SELECT COALESCE(SUM(on_hand_quantity),0) FROM inventory_truth WHERE shop_id=1 AND lasyncro_variant_id=$1)::int AS "onHand",
      (SELECT COUNT(*) FROM inventory_movements WHERE shop_id=1 AND lasyncro_variant_id=$1 AND movement_type='inbound_purchase')::int AS "inboundCount",
      (SELECT COALESCE(SUM(quantity_delta),0) FROM inventory_movements WHERE shop_id=1 AND lasyncro_variant_id=$1 AND movement_type='inbound_purchase')::int AS "inboundSum",
      (SELECT COUNT(*) FROM inventory_units WHERE shop_id=1 AND lasyncro_variant_id=$1)::int AS lsus,
      (SELECT COUNT(*) FROM stow_tasks WHERE shop_id=1 AND lasyncro_variant_id=$1)::int AS "stowTasks",
      (SELECT COUNT(*) FROM problem_center_tasks WHERE shop_id=1 AND lasyncro_variant_id=$1)::int AS "problemTasks"`, [variantId]);
  return row as VariantState;
}

async function variantIdOf(sku: string): Promise<string> {
  const rows = await sql<{ id: string }>(`SELECT lasyncro_variant_id AS id FROM variants WHERE shop_id=1 AND sku=$1`, [sku]);
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function receiveEvidence(jobId: string, poId: string) {
  const job = (await sql(`SELECT status, delivery_accounting_version::int AS version, units_accepted::int AS "unitsAccepted",
      units_rejected::int AS "unitsRejected" FROM receive_jobs WHERE shop_id=1 AND receive_job_id=$1`, [jobId]))[0];
  const lines = await sql(`SELECT l.receive_job_line_id AS id, v.sku, l.quantity_expected::int AS expected,
      l.quantity_count_confirmed::int AS counted, l.quantity_accepted::int AS accepted, l.quantity_rejected::int AS rejected,
      l.quantity_missing::int AS missing, l.quantity_deferred::int AS deferred, l.inspection_complete AS inspected,
      (SELECT COUNT(*) FROM inventory_units u WHERE u.shop_id=1 AND u.receive_job_line_id=l.receive_job_line_id)::int AS lsus,
      (SELECT COUNT(*) FROM inventory_units u WHERE u.shop_id=1 AND u.receive_job_line_id=l.receive_job_line_id AND u.label_printed_at IS NOT NULL)::int AS labelled,
      (SELECT COALESCE(json_agg(json_build_object('quantity', s.quantity, 'trigger', s.trigger)), '[]'::json) FROM stow_tasks s
        WHERE s.shop_id=1 AND s.receive_job_line_id=l.receive_job_line_id) AS stow
    FROM receive_job_lines l LEFT JOIN variants v ON v.lasyncro_variant_id=l.lasyncro_variant_id AND v.shop_id=l.shop_id
    WHERE l.shop_id=1 AND l.receive_job_id=$1 ORDER BY v.sku`, [jobId]);
  const exceptions = await sql(`SELECT e.receive_job_line_id AS "lineId", e.exception_type AS type, e.quantity_affected::int AS quantity
    FROM receive_exceptions e WHERE e.shop_id=1 AND e.receive_job_id=$1 ORDER BY e.exception_type`, [jobId]);
  const po = (await sql(`SELECT status, po_number::int AS number FROM purchase_orders WHERE shop_id=1 AND id=$1`, [poId]))[0];
  const poLines = await sql(`SELECT v.sku, li.quantity_ordered::int AS ordered, li.quantity_received::int AS received,
      li.quantity_pending_delivery::int AS pending
    FROM purchase_order_line_items li LEFT JOIN variants v ON v.lasyncro_variant_id=li.lasyncro_variant_id AND v.shop_id=li.shop_id
    WHERE li.shop_id=1 AND li.po_id=$1 ORDER BY v.sku`, [poId]);
  const finalization = (await sql(`SELECT f.reconciliation_id AS id FROM receive_reconciliation_finalizations f
    WHERE f.shop_id=1 AND f.receive_job_id=$1`, [jobId]));
  const movements = await sql(`SELECT lasyncro_variant_id AS "variantId", quantity_delta::int AS quantity FROM inventory_movements
    WHERE shop_id=1 AND movement_type='inbound_purchase' AND reference_id=$1`, [jobId]);
  return { job, lines, exceptions, po, poLines, finalizations: finalization.length, movements };
}

// ─── Browser session instrumentation ─────────────────────────────────────────

type Write = { method: string; path: string; status: number; body: Json | null; at: number };
type ConsoleError = { text: string; url: string };
type PrinterLookup = { status: number; at: number };
/** One Print labels click: the default-printer lookup and whether the PDF fallback opened. */
type PrintAttempt = { lineId: string; lookups: number[]; pdfStatus: number; tabOpened: boolean };

function instrument(page: Page) {
  const writes: Write[] = [];
  const consoleErrors: ConsoleError[] = [];
  const serverErrors: string[] = [];
  const httpErrors: string[] = [];
  const printerLookups: PrinterLookup[] = [];
  const bodies = new Map<Request, Json | null>();
  page.on('request', (request) => {
    if (!request.url().includes('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
    let body: Json | null = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    bodies.set(request, body);
  });
  page.on('response', (response: Response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${request.method()} ${url.pathname}`);
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${request.method()} ${url.pathname}`);
    if (request.method() === 'GET' && url.pathname === PRINTER_LOOKUP_PATH) printerLookups.push({ status: response.status(), at: Date.now() });
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || url.pathname.includes('/auth/')) return;
    writes.push({ method: request.method(), path: url.pathname, status: response.status(), body: bodies.get(request) ?? null, at: Date.now() });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text().slice(0, 300), url: message.location().url });
  });
  page.on('pageerror', (error) => consoleErrors.push({ text: `pageerror: ${String(error.message).slice(0, 300)}`, url: '' }));
  return { writes, consoleErrors, serverErrors, httpErrors, printerLookups };
}

function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return ''; }
}

/**
 * Splits console errors into the expected printer-lookup 404s and everything else.
 * Each print whose lookup answered exactly one 404 and whose PDF (200) opened in a
 * tab permits exactly one matching "Failed to load resource … 404" for that path.
 */
function classifyConsoleErrors(consoleErrors: ConsoleError[], prints: PrintAttempt[]) {
  const allowance = prints.filter((p) => p.lookups.length === 1 && p.lookups[0] === 404 && p.pdfStatus === 200 && p.tabOpened).length;
  const expected: ConsoleError[] = [];
  const unexpected: ConsoleError[] = [];
  for (const e of consoleErrors) {
    const printerFallback = /^Failed to load resource: the server responded with a status of 404\b/.test(e.text) && pathOf(e.url) === PRINTER_LOOKUP_PATH;
    (printerFallback && expected.length < allowance ? expected : unexpected).push(e);
  }
  return { allowance, expected, unexpected };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#outlined-adornment-email-login').fill(EMAIL);
  await page.locator('#outlined-adornment-password-login').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  // The decoded session user is written asynchronously after the redirect.
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('user');
    const u = raw ? JSON.parse(raw) : null;
    return u ? { shopId: u.shopId ?? u.shop_id ?? null, role: u.role ?? null } : null;
  })).toEqual({ shopId: 1, role: 'owner' });
}

/** The scroll root around the Receive session: no vertical or horizontal overflow at 1440×900. */
async function measureScroll(page: Page, phase: string) {
  return page.evaluate((label) => {
    const anchor = document.querySelector('[data-testid="receive-session-mode"]') ?? document.body;
    let el: HTMLElement | null = anchor.parentElement;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) break;
      if (/(auto|scroll)/.test(style.overflowY)) break;
      el = el.parentElement;
    }
    const root = el && el !== document.body ? el : document.scrollingElement as HTMLElement;
    return {
      phase: label,
      scrollHeight: root.scrollHeight, clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
      verticalOverflow: root.scrollHeight - root.clientHeight > 1,
      horizontalOverflow: root.scrollWidth - root.clientWidth > 1,
      windowOverflow: document.documentElement.scrollHeight - window.innerHeight > 1,
    };
  }, phase);
}

/** A fresh artifact path inside this run; an existing file is never overwritten. */
function artifactPath(kind: 'screens' | 'evidence' | 'traces', name: string) {
  const file = path.join(RUN_DIR, kind, name);
  if (fs.existsSync(file)) throw new Error(`GH-1241 artifact already exists: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

async function snap(page: Page, scenario: string, phase: string, visual: Json[]) {
  await page.screenshot({ path: artifactPath('screens', `${scenario}-${phase}.png`) });
  visual.push(await measureScroll(page, phase));
}

function writesOf(writes: Write[], method: string, pattern: RegExp) {
  return writes.filter((w) => w.method === method && pattern.test(w.path));
}

function saveEvidence(scenario: string, evidence: Json) {
  const text = JSON.stringify(evidence, null, 2);
  const leaks = secretLeaks(Buffer.from(text), [PASSWORD]);
  if (leaks.length) throw new Error(`GH-1241 evidence ${scenario} would contain secrets: ${leaks.join(', ')}`);
  fs.writeFileSync(artifactPath('evidence', `${scenario}.json`), text, { flag: 'wx' });
}

// ─── Secret-free trace retention ─────────────────────────────────────────────
//
// Playwright traces record request headers, cookies and bodies verbatim. The
// trace starts after login (no password entry, no token response) and is then
// rewritten with bearer tokens, JWTs, session cookies and token fields redacted.
// The rewritten archive is kept only when a rescan proves none remain.

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const SECRET_FIELD = /("(?:password|token|access_?token|refresh_?token|accessToken|refreshToken)"\s*:\s*")((?:[^"\\]|\\.)*)"/gi;
const SECRET_HEADER = /("name"\s*:\s*"(?:authorization|cookie|set-cookie)"\s*,\s*"value"\s*:\s*")((?:[^"\\]|\\.)*)"/gi;
const SECRET_COOKIE = /("name"\s*:\s*"[^"]*(?:token|session|sid)[^"]*"\s*,\s*"value"\s*:\s*")((?:[^"\\]|\\.)*)"/gi;
const tracing = new WeakSet<Page>();

const asLatin1 = (value: string) => Buffer.from(value, 'utf8').toString('latin1');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function secretLeaks(data: Buffer, exact: string[]) {
  const text = data.toString('latin1');
  const leaks: string[] = [];
  exact.filter((v) => v.length >= 6).forEach((v, i) => { if (text.includes(asLatin1(v))) leaks.push(`exact-secret-${i}`); });
  if (new RegExp(JWT.source).test(text)) leaks.push('jwt');
  if (/Bearer (?!\[REDACTED\])[A-Za-z0-9._~+/=-]{8,}/.test(text)) leaks.push('bearer');
  if (/refreshToken=(?!\[REDACTED\])[^;"\s]{8,}/.test(text)) leaks.push('refresh-cookie');
  return leaks;
}

function scrub(data: Buffer, exact: string[]) {
  let text = data.toString('latin1');
  for (const v of exact.filter((x) => x.length >= 6)) text = text.replace(new RegExp(escapeRegExp(asLatin1(v)), 'g'), '[REDACTED]');
  text = text.replace(JWT, '[REDACTED_JWT]')
    .replace(/Bearer [A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/refreshToken=[^;"\s]*/g, 'refreshToken=[REDACTED]')
    .replace(SECRET_FIELD, '$1[REDACTED]"').replace(SECRET_HEADER, '$1[REDACTED]"').replace(SECRET_COOKIE, '$1[REDACTED]"');
  return Buffer.from(text, 'latin1');
}

/** Minimal zip read (stored/deflated entries) — enough for Playwright trace archives. */
function readZip(zip: Buffer) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('trace archive: end of central directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('trace archive: bad central directory entry');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`trace archive: unsupported method ${method}`);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

function writeZip(entries: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

async function startTrace(page: Page, scenario: string) {
  await page.context().tracing.start({ title: `GH-1241 ${scenario}`, screenshots: true, snapshots: true });
  tracing.add(page);
}

/** Stops the scenario trace and keeps it only in scrubbed, rescanned form. */
async function saveTrace(page: Page, scenario: string) {
  if (!tracing.has(page)) return;
  tracing.delete(page);
  const sessionValues: string[] = [PASSWORD];
  try {
    sessionValues.push(...(await page.context().cookies()).map((c) => c.value));
    sessionValues.push(...await page.evaluate(() => Object.values(localStorage).filter((v): v is string => typeof v === 'string' && v.length >= 16 && !v.startsWith('{'))));
  } catch { /* page already gone; pattern redaction and rescan still apply */ }
  const raw = artifactPath('traces', `.raw-${scenario}.zip`);
  try {
    await page.context().tracing.stop({ path: raw });
    const scrubbed = readZip(fs.readFileSync(raw)).map((e) => ({ name: e.name, data: scrub(e.data, sessionValues) }));
    const leaks = scrubbed.flatMap((e) => secretLeaks(e.data, sessionValues).map((l) => `${e.name}:${l}`));
    if (leaks.length) throw new Error(`GH-1241 trace ${scenario} still contains secrets after scrubbing: ${leaks.slice(0, 10).join(', ')}`);
    fs.writeFileSync(artifactPath('traces', `${scenario}.zip`), writeZip(scrubbed), { flag: 'wx' });
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

// ─── Purchasing (Suppliers portal) ───────────────────────────────────────────

async function createPo(page: Page, lines: { sku: string; qty: number }[]) {
  await page.goto('/suppliers-portal');
  await page.getByRole('button', { name: 'New PO' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Purchase Order' });
  await dialog.getByRole('combobox', { name: 'Supplier' }).click();
  await page.getByRole('option', { name: SUPPLIER, exact: true }).click();
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) await dialog.getByRole('button', { name: 'Add line item' }).click();
    await dialog.getByRole('textbox', { name: 'Product / SKU' }).last().fill(lines[i].sku);
    await dialog.getByText(lines[i].sku, { exact: true }).last().click();
    await dialog.getByRole('spinbutton', { name: 'Qty *' }).last().fill(String(lines[i].qty));
  }
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/suppliers/purchase-orders'),
    dialog.getByRole('button', { name: 'Create PO' }).click(),
  ]);
  expect(response.status()).toBe(201);
  const po = (await response.json()).purchase_order;
  expect(PROTECTED_PO_NUMBERS).not.toContain(Number(po.po_number));
  await expect(dialog).toBeHidden();
  return { id: po.id as string, number: Number(po.po_number) };
}

function poCard(page: Page, number: number) {
  return page.locator('.MuiAccordion-root').filter({ has: page.getByRole('button', { name: new RegExp(`PO-${number}\\b`) }) }).first();
}

/** A PO card action. The list refetches after each status change and may collapse the card: re-expand until stable. */
async function cardAction(page: Page, number: number, name: string | RegExp) {
  const card = poCard(page, number);
  const summary = card.locator('.MuiAccordionSummary-root').first();
  const button = card.getByRole('button', { name, exact: typeof name === 'string' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    if (await button.isVisible().catch(() => false)) break;
    if ((await summary.getAttribute('aria-expanded').catch(() => null)) !== 'true') await summary.click();
    await button.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  }
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  return button;
}

async function dispatchReceive(page: Page, po: { id: string; number: number }) {
  await page.goto('/suppliers-portal');
  for (const [label, status] of [['Mark as sent', 'ordered'], ['Mark as arrived', 'shipped']] as const) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/v1/suppliers/purchase-orders/${po.id}/status`),
      (await cardAction(page, po.number, label)).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ status });
  }
  await (await cardAction(page, po.number, 'Receive via WMS')).click();
  await page.getByRole('radio', { name: OPERATOR_NAME }).first().click();
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/suppliers/purchase-orders/${po.id}/receive-jobs`),
    page.getByRole('button', { name: 'Assign Receive', exact: true }).click(),
  ]);
  expect(created.status()).toBe(201);
  const jobId = (await created.json()).receive_job_id as string;
  // Assigning to oneself hands straight off to the Receive session; otherwise open it from the card.
  const handedOff = await page.waitForURL(
    (url) => url.pathname === '/wms' && url.searchParams.get('receiveJobId') === jobId, { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  if (!handedOff) {
    await (await cardAction(page, po.number, /^(Open|Resume) Receive$/)).click();
    await page.waitForURL((url) => url.pathname === '/wms' && url.searchParams.get('receiveJobId') === jobId);
  }
  return jobId;
}

// ─── Receive session ─────────────────────────────────────────────────────────

const modeMarker = (page: Page) => page.getByTestId('receive-session-mode');

async function lineIdsBySku(jobId: string) {
  const rows = await sql<{ id: string; sku: string }>(`SELECT l.receive_job_line_id AS id, v.sku FROM receive_job_lines l
    JOIN variants v ON v.lasyncro_variant_id=l.lasyncro_variant_id AND v.shop_id=l.shop_id WHERE l.shop_id=1 AND l.receive_job_id=$1`, [jobId]);
  return Object.fromEntries(rows.map((r) => [r.sku, r.id]));
}

async function startReceiving(page: Page, jobId: string) {
  await expect(modeMarker(page)).toHaveAttribute('data-receive-mode', 'grouped');
  const [claim] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/suppliers/receive-jobs/${jobId}/claim`),
    page.getByRole('button', { name: /start receiving/i }).click(),
  ]);
  expect(claim.status()).toBe(200);
  await expect(page.getByPlaceholder(/scan barcode/i)).toBeVisible();
}

async function countLine(page: Page, jobId: string, lineId: string, good: number) {
  await page.getByTestId(`receive-count-line-${lineId}`).click();
  const current = page.getByTestId('receive-count-current');
  const confirmPath = `/api/v1/suppliers/receive-jobs/${jobId}/lines/${lineId}/confirm-count`;
  if (good === 0) {
    const [confirmed] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === confirmPath),
      current.getByRole('button', { name: /none arrived/i }).click(),
    ]);
    expect(confirmed.status()).toBe(200);
  } else {
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/lines/${lineId}/progress`)),
      current.getByRole('spinbutton', { name: /count/i }).fill(String(good)),
    ]);
    expect(saved.status()).toBe(200);
    const [confirmed] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === confirmPath),
      current.getByRole('button', { name: /confirm count/i }).click(),
    ]);
    expect(confirmed.status()).toBe(200);
  }
  await expect(page.getByTestId(`receive-count-line-${lineId}`)).toHaveAttribute('data-count-state', 'confirmed');
  await expect(page.getByTestId(`receive-count-line-${lineId}`)).toHaveAttribute('data-count', String(good));
}

async function reviewAndFinalize(page: Page, jobId: string, allocations: Record<string, { missing?: number; later?: number; damaged?: number }>) {
  await page.getByRole('button', { name: /^review and finish$/i }).click();
  await expect(page.getByTestId('receive-review')).toBeVisible();
  for (const [lineId, a] of Object.entries(allocations)) {
    const row = page.getByTestId(`receive-review-line-${lineId}`);
    if (a.missing !== undefined) await row.getByRole('spinbutton', { name: /missing/i }).fill(String(a.missing));
    if (a.later !== undefined) await row.getByRole('spinbutton', { name: /coming later/i }).fill(String(a.later));
    if (a.damaged !== undefined) await row.getByRole('spinbutton', { name: /damaged/i }).fill(String(a.damaged));
    await expect(row).toHaveAttribute('data-settled', 'true');
  }
  const confirm = page.getByRole('button', { name: /confirm and continue/i });
  await expect(confirm).toBeEnabled();
  const finalizePath = `/api/v1/suppliers/receive-jobs/${jobId}/reconciliation/finalize`;
  const [finalized] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === finalizePath),
    confirm.click(),
  ]);
  expect(finalized.status()).toBe(200);
  expect((await finalized.json()).status).toBe('finalized');
  await expect(modeMarker(page)).toHaveAttribute('data-receive-mode', 'grouped_finalized');
}

async function closeReceive(page: Page, jobId: string) {
  const close = page.getByRole('button', { name: /^close receive$/i });
  await expect(close).toBeVisible();
  await page.getByLabel(/actual delivery date/i).fill(today());
  const [closed] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/suppliers/receive-jobs/${jobId}/close`),
    close.click(),
  ]);
  expect(closed.status()).toBe(200);
  await expect(page.getByText('Receive complete', { exact: true })).toBeVisible();
}

const ACCOUNTING_WRITE = /\/(confirm-count|progress|reconciliation\/draft|reconciliation\/finalize|exception|inspect)$/;

/** After finalization nothing re-counts, re-inspects or re-reconciles. */
function expectNoAccountingAfter(writes: Write[], finalizeAt: number) {
  expect(writes.filter((w) => w.at > finalizeAt && ACCOUNTING_WRITE.test(w.path)).map((w) => `${w.method} ${w.path}`)).toEqual([]);
}

function finalizeWrite(writes: Write[], jobId: string) {
  const finalizes = writesOf(writes, 'POST', new RegExp(`/receive-jobs/${jobId}/reconciliation/finalize$`));
  expect(finalizes.filter((w) => w.status === 200)).toHaveLength(1);
  return finalizes[finalizes.length - 1];
}

function payloadLine(write: Write, lineId: string) {
  return (write.body?.lines ?? []).find((l: Json) => l.receive_job_line_id === lineId);
}

async function completedRecovery(page: Page, jobId: string) {
  await page.goto(`/wms?receiveJobId=${jobId}`);
  await expect(page.getByText('Receive complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^close receive$/i })).toHaveCount(0);
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

test.beforeAll(environmentGate);
test.afterEach(async ({ page }, testInfo) => { await saveTrace(page, testInfo.title.split(' ')[0]); });

test('A — partial delivery: expected 3, good 1, missing 2 → finalize → close → Stow 1', async ({ page }) => {
  const sku = 'KIT-48530-8914';
  const variantId = await variantIdOf(sku);
  const before = await variantState(variantId);
  const io = instrument(page);
  const visual: Json[] = [];
  await login(page);
  await startTrace(page, 'A');

  const po = await createPo(page, [{ sku, qty: 3 }]);
  const jobId = await dispatchReceive(page, po);
  const lines = await lineIdsBySku(jobId);
  await startReceiving(page, jobId);
  await snap(page, 'A', '1-counting', visual);
  await countLine(page, jobId, lines[sku], 1);

  // Reload: the confirmed good count restores from canonical evidence; nothing is written.
  const writesBeforeReload = io.writes.length;
  await page.reload();
  await expect(modeMarker(page)).toHaveAttribute('data-receive-mode', 'grouped');
  await expect(page.getByTestId(`receive-count-line-${lines[sku]}`)).toHaveAttribute('data-count-state', 'confirmed');
  await expect(page.getByTestId(`receive-count-line-${lines[sku]}`)).toHaveAttribute('data-count', '1');
  expect(io.writes.length).toBe(writesBeforeReload);

  await page.getByRole('button', { name: /^review and finish$/i }).click();
  await expect(page.getByTestId(`receive-review-line-${lines[sku]}`)).toHaveAttribute('data-difference', '-2');
  await snap(page, 'A', '2-review', visual);
  await page.getByRole('button', { name: /back to counting/i }).click();
  await reviewAndFinalize(page, jobId, { [lines[sku]]: { missing: 2 } });
  const finalize = finalizeWrite(io.writes, jobId);
  expect(payloadLine(finalize, lines[sku])).toMatchObject({
    quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0, quantity_held_recoverable: 0,
    new_exceptions: [expect.objectContaining({ exception_type: 'missing_item', quantity_affected: 2 })],
  });
  await snap(page, 'A', '3-close', visual);
  await closeReceive(page, jobId);
  await expect(page.getByText(/received units are now available for stow/i)).toBeVisible();
  await snap(page, 'A', '4-complete', visual);
  await completedRecovery(page, jobId);
  expectNoAccountingAfter(io.writes, finalize.at);

  const after = await variantState(variantId);
  const evidence = await receiveEvidence(jobId, po.id);
  saveEvidence('A', { po, jobId, before, after, evidence, writes: io.writes, visual, consoleErrors: io.consoleErrors, httpErrors: io.httpErrors, serverErrors: io.serverErrors });
  expect({
    job: evidence.job.status, poStatus: evidence.po.status, poLines: evidence.poLines,
    line: evidence.lines.map((l: Json) => ({ accepted: l.accepted, missing: l.missing, lsus: l.lsus, stow: l.stow })),
    exceptions: evidence.exceptions.map((e: Json) => ({ type: e.type, quantity: e.quantity })),
    finalizations: evidence.finalizations, movements: evidence.movements.map((m: Json) => m.quantity),
    delta: { onHand: after.onHand - before.onHand, inboundCount: after.inboundCount - before.inboundCount, lsus: after.lsus - before.lsus,
      stowTasks: after.stowTasks - before.stowTasks, problemTasks: after.problemTasks - before.problemTasks },
  }).toEqual({
    job: 'closed', poStatus: 'received', poLines: [{ sku, ordered: 3, received: 1, pending: 0 }],
    line: [{ accepted: 1, missing: 2, lsus: 1, stow: [{ quantity: 1, trigger: 'inbound_stock' }] }],
    exceptions: [{ type: 'missing_item', quantity: 2 }],
    finalizations: 1, movements: [1],
    delta: { onHand: 1, inboundCount: 1, lsus: 1, stowTasks: 1, problemTasks: 0 },
  });
  expect(io.serverErrors).toEqual([]);
  expect.soft(io.consoleErrors).toEqual([]);
  for (const v of visual) expect.soft(v, `scroll-free ${v.phase}`).toMatchObject({ verticalOverflow: false, horizontalOverflow: false, windowOverflow: false });
});

test('B — two barcode-less products: print and acknowledge both label sets, then close once', async ({ page }) => {
  const skus = ['QA-CAP-OS', 'QA-HOODIE-M'];
  const variantIds = await Promise.all(skus.map(variantIdOf));
  const before = await Promise.all(variantIds.map(variantState));
  const io = instrument(page);
  const visual: Json[] = [];
  await login(page);
  await startTrace(page, 'B');

  const po = await createPo(page, [{ sku: skus[0], qty: 2 }, { sku: skus[1], qty: 1 }]);
  const jobId = await dispatchReceive(page, po);
  const lines = await lineIdsBySku(jobId);
  await startReceiving(page, jobId);
  await countLine(page, jobId, lines[skus[0]], 2);
  await countLine(page, jobId, lines[skus[1]], 1);
  await snap(page, 'B', '1-counted', visual);
  await reviewAndFinalize(page, jobId, {});
  const finalize = finalizeWrite(io.writes, jobId);
  expect(payloadLine(finalize, lines[skus[0]])).toMatchObject({ quantity_accepted: 2, quantity_missing: 0, new_exceptions: [] });
  expect(payloadLine(finalize, lines[skus[1]])).toMatchObject({ quantity_accepted: 1, quantity_missing: 0, new_exceptions: [] });

  const acknowledge = page.getByTestId('confirm-unit-labels-printed');
  const ackPath = (lineId: string) => `/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`;
  const skuByLine = Object.fromEntries(Object.entries(lines).map(([sku, id]) => [id, sku]));
  const handled: string[] = [];
  const prints: PrintAttempt[] = [];

  for (let n = 0; n < 2; n += 1) {
    await expect(acknowledge).toBeVisible();
    // Close stays unavailable while labels are outstanding.
    await expect(page.getByRole('button', { name: /^close receive$/i })).toHaveCount(0);
    await snap(page, 'B', `2-hold-${n + 1}`, visual);

    // Print: the held line's label PDF request succeeds; printing alone acknowledges nothing.
    const printAt = Date.now();
    const popup = page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => null);
    const [pdf] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/wms\/receive-job-lines\/[^/]+\/unit-labels$/.test(new URL(r.url()).pathname)),
      page.getByRole('button', { name: /^print labels$/i }).click(),
    ]);
    expect(pdf.status()).toBe(200);
    const lineId = new URL(pdf.url()).pathname.split('/')[5];
    expect(skuByLine[lineId]).toBeTruthy();
    expect(handled).not.toContain(skuByLine[lineId]);
    const tab = await popup;
    prints.push({ lineId, lookups: io.printerLookups.filter((l) => l.at >= printAt).map((l) => l.status), pdfStatus: pdf.status(), tabOpened: tab !== null });
    tab?.close().catch(() => {});
    await page.waitForTimeout(500);
    expect(writesOf(io.writes, 'POST', /\/unit-labels\/printed$/).filter((w) => w.path === ackPath(lineId))).toHaveLength(0);
    await expect(page.getByRole('button', { name: /^close receive$/i })).toHaveCount(0);

    const [acked] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && /\/unit-labels\/printed$/.test(new URL(r.url()).pathname)),
      acknowledge.click(),
    ]);
    expect(acked.status()).toBe(200);
    expect(new URL(acked.url()).pathname).toBe(ackPath(lineId));
    handled.push(skuByLine[lineId]);

    if (n === 0) {
      // Reload restores the other product, still on label hold.
      await page.reload();
      await expect(modeMarker(page)).toHaveAttribute('data-receive-mode', 'grouped_finalized');
      await expect(acknowledge).toBeVisible();
    }
  }
  expect(handled.sort()).toEqual([...skus].sort());
  await snap(page, 'B', '3-close', visual);
  await closeReceive(page, jobId);
  await snap(page, 'B', '4-complete', visual);
  expectNoAccountingAfter(io.writes, finalize.at);
  expect(writesOf(io.writes, 'POST', new RegExp(`/receive-jobs/${jobId}/close$`))).toHaveLength(1);

  const after = await Promise.all(variantIds.map(variantState));
  const evidence = await receiveEvidence(jobId, po.id);
  const consoleClassification = classifyConsoleErrors(io.consoleErrors, prints);
  saveEvidence('B', { po, jobId, before, after, evidence, writes: io.writes, visual, prints, consoleClassification, httpErrors: io.httpErrors, serverErrors: io.serverErrors });
  expect({
    job: evidence.job.status, poStatus: evidence.po.status,
    lines: evidence.lines.map((l: Json) => ({ sku: l.sku, accepted: l.accepted, lsus: l.lsus, labelled: l.labelled, stow: l.stow })),
    movements: evidence.movements.length,
    delta: variantIds.map((_, i) => ({ onHand: after[i].onHand - before[i].onHand, inboundCount: after[i].inboundCount - before[i].inboundCount,
      lsus: after[i].lsus - before[i].lsus, stowTasks: after[i].stowTasks - before[i].stowTasks })),
  }).toEqual({
    job: 'closed', poStatus: 'received',
    lines: [
      { sku: skus[0], accepted: 2, lsus: 2, labelled: 2, stow: [{ quantity: 2, trigger: 'inbound_stock' }] },
      { sku: skus[1], accepted: 1, lsus: 1, labelled: 1, stow: [{ quantity: 1, trigger: 'inbound_stock' }] },
    ],
    movements: 2,
    delta: [
      { onHand: 2, inboundCount: 1, lsus: 2, stowTasks: 1 },
      { onHand: 1, inboundCount: 1, lsus: 1, stowTasks: 1 },
    ],
  });
  expect(io.serverErrors).toEqual([]);
  expect.soft(consoleClassification.unexpected).toEqual([]);
  for (const v of visual) expect.soft(v, `scroll-free ${v.phase}`).toMatchObject({ verticalOverflow: false, horizontalOverflow: false, windowOverflow: false });
});

test('C — fully missing: good 0 (None arrived), missing 3 → close with no stock, LSU or Stow', async ({ page }) => {
  const sku = 'OUT-17458-2930';
  const variantId = await variantIdOf(sku);
  const before = await variantState(variantId);
  const io = instrument(page);
  const visual: Json[] = [];
  await login(page);
  await startTrace(page, 'C');

  const po = await createPo(page, [{ sku, qty: 3 }]);
  const jobId = await dispatchReceive(page, po);
  const lines = await lineIdsBySku(jobId);
  await startReceiving(page, jobId);
  await countLine(page, jobId, lines[sku], 0);
  await snap(page, 'C', '1-counted', visual);
  await reviewAndFinalize(page, jobId, { [lines[sku]]: { missing: 3 } });
  const finalize = finalizeWrite(io.writes, jobId);
  expect(payloadLine(finalize, lines[sku])).toMatchObject({
    quantity_accepted: 0, quantity_rejected: 0, quantity_missing: 3, quantity_deferred: 0,
    new_exceptions: [expect.objectContaining({ exception_type: 'missing_item', quantity_affected: 3 })],
  });
  await closeReceive(page, jobId);
  await expect(page.getByText(/No usable items received\. Nothing to put away\./)).toBeVisible();
  await expect(page.getByText(/available for stow/i)).toHaveCount(0);
  await snap(page, 'C', '2-complete', visual);
  expectNoAccountingAfter(io.writes, finalize.at);

  const after = await variantState(variantId);
  const evidence = await receiveEvidence(jobId, po.id);
  saveEvidence('C', { po, jobId, before, after, evidence, writes: io.writes, visual, consoleErrors: io.consoleErrors, httpErrors: io.httpErrors, serverErrors: io.serverErrors });
  expect({
    job: evidence.job.status, poStatus: evidence.po.status, poLines: evidence.poLines,
    line: evidence.lines.map((l: Json) => ({ counted: l.counted, accepted: l.accepted, missing: l.missing, lsus: l.lsus, stow: l.stow })),
    exceptions: evidence.exceptions.map((e: Json) => ({ type: e.type, quantity: e.quantity })),
    movements: evidence.movements,
    delta: { onHand: after.onHand - before.onHand, inboundCount: after.inboundCount - before.inboundCount, lsus: after.lsus - before.lsus,
      stowTasks: after.stowTasks - before.stowTasks, problemTasks: after.problemTasks - before.problemTasks },
  }).toEqual({
    job: 'closed', poStatus: 'received', poLines: [{ sku, ordered: 3, received: 0, pending: 0 }],
    line: [{ counted: 0, accepted: 0, missing: 3, lsus: 0, stow: [] }],
    exceptions: [{ type: 'missing_item', quantity: 3 }],
    movements: [],
    delta: { onHand: 0, inboundCount: 0, lsus: 0, stowTasks: 0, problemTasks: 0 },
  });
  expect(io.serverErrors).toEqual([]);
  expect.soft(io.consoleErrors).toEqual([]);
  for (const v of visual) expect.soft(v, `scroll-free ${v.phase}`).toMatchObject({ verticalOverflow: false, horizontalOverflow: false, windowOverflow: false });
});

test('D — coming later: good 2, later 3 → close credits 2, 3 stay pending, PO partially received', async ({ page }) => {
  const sku = 'TEC-14066-7218';
  const variantId = await variantIdOf(sku);
  const before = await variantState(variantId);
  const io = instrument(page);
  const visual: Json[] = [];
  await login(page);
  await startTrace(page, 'D');

  const po = await createPo(page, [{ sku, qty: 5 }]);
  const jobId = await dispatchReceive(page, po);
  const lines = await lineIdsBySku(jobId);
  await startReceiving(page, jobId);
  await countLine(page, jobId, lines[sku], 2);

  // Back to WMS, then reopen the same job from the Operations board: canonical state is kept.
  await page.getByRole('button', { name: 'Back to WMS' }).click();
  await page.waitForURL((url) => url.pathname === '/wms' && !url.searchParams.get('receiveJobId'));
  await expect(modeMarker(page)).toHaveCount(0);
  await page.getByTestId(`receive-work-card-${jobId}`).getByRole('button', { name: /resume receive|open receive/i }).click();
  await expect(modeMarker(page)).toHaveAttribute('data-receive-mode', 'grouped');
  await expect(page.getByTestId(`receive-count-line-${lines[sku]}`)).toHaveAttribute('data-count', '2');

  await reviewAndFinalize(page, jobId, { [lines[sku]]: { later: 3 } });
  const finalize = finalizeWrite(io.writes, jobId);
  expect(payloadLine(finalize, lines[sku])).toMatchObject({
    quantity_accepted: 2, quantity_missing: 0, quantity_deferred: 3, new_exceptions: [],
  });
  await closeReceive(page, jobId);
  await expect(page.getByText(/received units are now available for stow/i)).toBeVisible();
  await snap(page, 'D', '1-complete', visual);
  expectNoAccountingAfter(io.writes, finalize.at);

  const after = await variantState(variantId);
  const evidence = await receiveEvidence(jobId, po.id);
  saveEvidence('D', { po, jobId, before, after, evidence, writes: io.writes, visual, consoleErrors: io.consoleErrors, httpErrors: io.httpErrors, serverErrors: io.serverErrors });
  expect({
    job: evidence.job.status, poStatus: evidence.po.status, poLines: evidence.poLines,
    line: evidence.lines.map((l: Json) => ({ accepted: l.accepted, deferred: l.deferred, missing: l.missing, lsus: l.lsus, stow: l.stow })),
    exceptions: evidence.exceptions,
    delta: { onHand: after.onHand - before.onHand, inboundCount: after.inboundCount - before.inboundCount, lsus: after.lsus - before.lsus,
      stowTasks: after.stowTasks - before.stowTasks },
  }).toEqual({
    job: 'closed', poStatus: 'partially_received', poLines: [{ sku, ordered: 5, received: 2, pending: 3 }],
    line: [{ accepted: 2, deferred: 3, missing: 0, lsus: 2, stow: [{ quantity: 2, trigger: 'inbound_stock' }] }],
    exceptions: [],
    delta: { onHand: 2, inboundCount: 1, lsus: 2, stowTasks: 1 },
  });
  expect(io.serverErrors).toEqual([]);
  expect.soft(io.consoleErrors).toEqual([]);
  for (const v of visual) expect.soft(v, `scroll-free ${v.phase}`).toMatchObject({ verticalOverflow: false, horizontalOverflow: false, windowOverflow: false });
});
