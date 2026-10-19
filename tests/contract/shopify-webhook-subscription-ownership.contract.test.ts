/**
 * GH-1262 A2.2 B2 — Shopify webhook subscription ownership.
 *
 * products/delete must reach EXISTING installations, not only shops that run
 * OAuth again. It is therefore an app-specific subscription declared in
 * shopify.app.toml (applied by Shopify to every installation of the released
 * app version) and must never also be registered per shop through
 * webhookSubscriptionCreate, which would double-subscribe the topic.
 *
 * Pinned here:
 *   - the TOML declares exactly one app-specific products/delete subscription,
 *     on the same verified ingress the shop-specific topics use;
 *   - no other app-specific topic is declared;
 *   - compliance subscriptions, webhook api_version and the required scopes
 *     (including read_products) are unchanged;
 *   - imperative registration excludes PRODUCTS_DELETE and keeps every other
 *     shop-specific topic, in order.
 *
 * DB-free and provider-free: fetch is replaced for the registration call and
 * every request is asserted to target only the synthetic shop domain.
 *
 * No TOML parser is a repository dependency, so a strict parser for the TOML
 * subset this file uses (tables, arrays of tables, strings, booleans, string
 * arrays, comments) is used. It fails closed on anything outside that subset.
 */
import fs from 'fs';
import path from 'path';
import { registerShopifyWebhooks } from 'api-src/services/shopify/shopifyWebhooks.core';
import { SHOPIFY_REQUIRED_SCOPE_STRING } from 'api-src/services/shopify/shopifyScopes';

const REPO = path.resolve(__dirname, '..', '..');
const TOML_PATH = path.join(REPO, 'shopify.app.toml');
const VERIFIED_INGRESS = '/api/v1/shopify/webhooks';

// Shop-specific topics registered through webhookSubscriptionCreate, in order.
const EXPECTED_SHOP_SPECIFIC_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_PAID',
  'ORDERS_FULFILLED',
  'ORDERS_CANCELLED',
  'FULFILLMENTS_CREATE',
  'FULFILLMENTS_UPDATE',
  'REFUNDS_CREATE',
  'INVENTORY_LEVELS_UPDATE',
  'INVENTORY_ITEMS_UPDATE',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'APP_UNINSTALLED',
  'APP_SUBSCRIPTIONS_UPDATE',
];

// ── strict TOML-subset parser (fail closed) ─────────────────────────────────

type TomlScalar = string | boolean;
type TomlTable = { [key: string]: TomlScalar | TomlScalar[] | TomlTable | TomlTable[] };

function unsupported(lineNo: number, detail: string): never {
  throw new Error(`TOML_SUBSET_UNSUPPORTED line ${lineNo}: ${detail}`);
}

/** Removes a # comment outside double-quoted strings; escapes are unsupported. */
function stripComment(line: string, lineNo: number): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') unsupported(lineNo, 'escape sequences');
    if (ch === "'") unsupported(lineNo, 'literal strings');
    if (ch === '"') inString = !inString;
    if (ch === '#' && !inString) return line.slice(0, i);
  }
  if (inString) unsupported(lineNo, 'unterminated string');
  return line;
}

/** Splits on commas outside strings. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let inString = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '"') inString = !inString;
    if (inner[i] === ',' && !inString) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.trim());
}

function parseScalar(raw: string, lineNo: number): TomlScalar {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  const str = /^"([^"]*)"$/.exec(text);
  if (str) return str[1];
  return unsupported(lineNo, `value ${text}`);
}

function parseValue(raw: string, lineNo: number): TomlScalar | TomlScalar[] {
  const text = raw.trim();
  if (!text.startsWith('[')) return parseScalar(text, lineNo);
  if (!text.endsWith(']')) unsupported(lineNo, 'unterminated array');
  const parts = splitTopLevel(text.slice(1, -1));
  // A single trailing comma (or an empty array) leaves one empty final part.
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((part) => {
    if (part === '') unsupported(lineNo, 'empty array element');
    if (part.startsWith('[')) unsupported(lineNo, 'nested arrays');
    return parseScalar(part, lineNo);
  });
}

function bracketDepth(text: string): number {
  let depth = 0;
  let inString = false;
  for (const ch of text) {
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']') depth--;
  }
  return depth;
}

function tableAt(root: TomlTable, keys: string[], lineNo: number): TomlTable {
  let table = root;
  for (const key of keys) {
    const next = table[key];
    if (next === undefined) {
      const created: TomlTable = {};
      table[key] = created;
      table = created;
    } else if (Array.isArray(next) && next.length > 0 && typeof next[0] === 'object') {
      table = next[next.length - 1] as TomlTable;
    } else if (typeof next === 'object' && !Array.isArray(next)) {
      table = next as TomlTable;
    } else {
      unsupported(lineNo, `key ${key} is not a table`);
    }
  }
  return table;
}

function parseTomlSubset(source: string): TomlTable {
  const root: TomlTable = {};
  let current = root;
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = stripComment(lines[i], lineNo).trim();
    if (line === '') continue;

    const arrayTable = /^\[\[([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\]\]$/.exec(line);
    if (arrayTable) {
      const keys = arrayTable[1].split('.');
      const parent = tableAt(root, keys.slice(0, -1), lineNo);
      const last = keys[keys.length - 1];
      const existing = parent[last];
      if (existing !== undefined && !Array.isArray(existing)) unsupported(lineNo, `${last} redefined`);
      const list = (existing ?? []) as TomlTable[];
      const entry: TomlTable = {};
      list.push(entry);
      parent[last] = list;
      current = entry;
      continue;
    }

    const table = /^\[([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\]$/.exec(line);
    if (table) {
      current = tableAt(root, table[1].split('.'), lineNo);
      continue;
    }

    const pair = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) unsupported(lineNo, lines[i]);
    let raw = pair![2];
    while (bracketDepth(raw) > 0) {
      i++;
      if (i >= lines.length) unsupported(lineNo, 'unterminated multi-line array');
      raw += ' ' + stripComment(lines[i], i + 1).trim();
    }
    if (bracketDepth(raw) !== 0) unsupported(lineNo, 'unbalanced brackets');
    if (pair![1] in current) unsupported(lineNo, `duplicate key ${pair![1]}`);
    current[pair![1]] = parseValue(raw, lineNo);
  }
  return root;
}

const config = parseTomlSubset(fs.readFileSync(TOML_PATH, 'utf8'));
const webhooks = config.webhooks as TomlTable;
const subscriptions = (webhooks?.subscriptions ?? []) as TomlTable[];

// ── app-specific ownership ──────────────────────────────────────────────────

describe('GH-1262 B2 — shopify.app.toml owns products/delete for every installation', () => {
  it('declares exactly one app-specific products/delete subscription, on the verified ingress', () => {
    const deleteSubscriptions = subscriptions.filter(
      (s) => Array.isArray(s.topics) && (s.topics as TomlScalar[]).includes('products/delete'));
    expect(deleteSubscriptions).toEqual([{ topics: ['products/delete'], uri: VERIFIED_INGRESS }]);
  });

  it('declares no other app-specific topic (no app-owned product create/update)', () => {
    const appTopics = subscriptions.flatMap((s) => (Array.isArray(s.topics) ? (s.topics as TomlScalar[]) : []));
    expect(appTopics).toEqual(['products/delete']);
  });

  it('keeps the compliance subscription and webhook api_version unchanged', () => {
    expect(webhooks.api_version).toBe('2026-04');
    const compliance = subscriptions.filter((s) => s.compliance_topics !== undefined);
    expect(compliance).toEqual([{
      uri: VERIFIED_INGRESS,
      compliance_topics: ['customers/data_request', 'customers/redact', 'shop/redact'],
    }]);
    expect(subscriptions).toHaveLength(2);
  });

  it('keeps the required scopes, including read_products', () => {
    const scopes = (config.access_scopes as TomlTable).scopes as string;
    expect(scopes).toBe(SHOPIFY_REQUIRED_SCOPE_STRING);
    expect(scopes.split(',')).toContain('read_products');
  });
});

// ── shop-specific registration ──────────────────────────────────────────────

describe('GH-1262 B2 — imperative registration never double-subscribes products/delete', () => {
  const SHOP_DOMAIN = 'gh1262-b2-ownership.myshopify.com';
  const APP_BASE_URL = 'https://gh1262-b2.invalid';
  const realFetch = globalThis.fetch;
  const savedBaseUrl = process.env.APP_BASE_URL;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = savedBaseUrl;
  });

  async function capturedRegistrations() {
    const calls: Array<{ host: string; topic: string | undefined; callbackUrl: string | undefined }> = [];
    process.env.APP_BASE_URL = APP_BASE_URL;
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      const query = String(JSON.parse(String(init?.body ?? '{}')).query ?? '');
      calls.push({
        host: new URL(String(input)).hostname,
        topic: /topic:\s*([A-Z_]+)/.exec(query)?.[1],
        callbackUrl: /callbackUrl:\s*"([^"]+)"/.exec(query)?.[1],
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' }, userErrors: [] } } }),
        text: async () => '',
      } as unknown as Response;
    }) as typeof fetch;

    await registerShopifyWebhooks(SHOP_DOMAIN, 'gh1262-b2-test-token');
    return calls;
  }

  it('registers every shop-specific topic except PRODUCTS_DELETE, unchanged and in order', async () => {
    const calls = await capturedRegistrations();
    expect(calls.map((c) => c.topic)).toEqual(EXPECTED_SHOP_SPECIFIC_TOPICS);
    expect(calls.map((c) => c.topic)).not.toContain('PRODUCTS_DELETE');
  });

  it('uses the same verified ingress as the app-specific subscription and calls only the shop domain', async () => {
    const calls = await capturedRegistrations();
    const deleteSubscription = subscriptions.find((s) => Array.isArray(s.topics));
    expect(new Set(calls.map((c) => c.callbackUrl))).toEqual(new Set([`${APP_BASE_URL}${deleteSubscription!.uri}`]));
    expect(new Set(calls.map((c) => c.host))).toEqual(new Set([SHOP_DOMAIN]));
  });
});
