// tests/contract/commercial-subscription-writer-boundary.contract.test.ts
//
// BILL-ENTITLEMENT-01 / P0-B2 — architecture contract for the canonical
// commercial subscription mutation boundary. PERMANENT, authored RED.
// ===========================================================================
// WHAT THIS PROTECTS
//   Entitlement-authoritative subscription state (tier, status,
//   billing_provider) decides what a merchant is allowed to do and what they
//   are billed. A direct mutation of shop_subscriptions that changes any of
//   those three columns outside the canonical transition service produces an
//   unprovenanced entitlement change: no before/after record, no source, no
//   reason, no actor. This contract fails while any such writer remains, and
//   fails again the moment a NEW one is introduced anywhere in the runtime.
//
// INDEPENDENTLY RED
//   This suite touches neither the database nor the (absent) service module.
//   It is RED purely because the 9 audited direct authoritative writers are
//   still in place.
//
// MECHANISM — AST, not grep
//   A same-line regex cannot see a fluent knex chain that spans lines, cannot
//   tell `.insert({tier})` from `.first('tier')`, and cannot read a
//   `.merge([...])` column list. This scanner uses the TypeScript compiler
//   API (already a repository devDependency):
//
//     1. locate every chain root  X('shop_subscriptions')
//     2. walk UP the fluent chain collecting method names and arguments
//     3. classify: read (no mutating method) vs write
//     4. for a write, collect the exact column set from
//        .insert({...}) / .update({...}) / .merge([...] | {...})
//     5. a write is AUTHORITATIVE iff its columns intersect
//        { tier, status, billing_provider }
//
//   Reads are never violations. Non-authoritative writes are never
//   violations. Only the three entitlement-deciding columns are governed.

import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const REPO = path.resolve(__dirname, '../..');

/** Active production runtime source only. */
const SCAN_ROOTS = ['apps/backend/src', 'packages/backend-core/src'];

const SKIP_DIR_SEGMENTS = ['node_modules', 'dist', 'build', 'generated', '__generated__', '.claude'];

const TABLE = 'shop_subscriptions';

/** The only columns that decide entitlement. */
const AUTHORITATIVE_COLUMNS = new Set(['tier', 'status', 'billing_provider']);

const MUTATING_METHODS = new Set([
  'insert',
  'update',
  'upsert',
  'del',
  'delete',
  'increment',
  'decrement',
]);

/** The frozen canonical boundary — the ONE place allowed to mutate directly. */
const CANONICAL_SERVICE = 'apps/backend/src/services/billing/subscriptionTransition.service.ts';

/**
 * Paths deliberately outside THIS runtime boundary.
 *   - seed_reviewer.ts is a non-runtime operator script.
 */
const EXCLUDED_PATHS = new Set([
  'apps/backend/src/scripts/seed_reviewer.ts',
]);

/**
 * Known non-authoritative writers, kept as an explicit allow-list so the
 * exception stays visible and is re-verified on every run rather than assumed.
 */
const KNOWN_NON_AUTHORITATIVE_WRITERS: Array<{
  file: string;
  symbol: string;
  allowedColumns: string[];
}> = [
  {
    file: 'apps/backend/src/api/billing/handlers/handleCheckoutSetupComplete.ts',
    symbol: 'handleCheckoutSetupComplete',
    allowedColumns: ['stripe_customer_id', 'updated_at'],
  },
];

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

interface SubscriptionAccess {
  file: string;
  symbol: string;
  line: number;
  methods: string[];
  columns: string[];
  isWrite: boolean;
  isAuthoritative: boolean;
}

function listSourceFiles(root: string): string[] {
  const abs = path.join(REPO, root);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIR_SEGMENTS.includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(path.relative(REPO, path.join(dir, entry.name)));
    }
  };
  walk(abs);
  return out.sort();
}

function stringLiteralValue(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

/** `trx('shop_subscriptions')` / `db('shop_subscriptions as s')` */
function isTableChainRoot(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  if (node.arguments.length !== 1) return false;
  const raw = stringLiteralValue(node.arguments[0]);
  if (raw === null) return false;
  return raw.split(/\s+/)[0] === TABLE;
}

/** Column names from `.insert({...})`, `.update({...})`, `.merge([...] | {...})`. */
function columnsFromArgument(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((prop) => {
      const name = prop.name;
      if (!name) return [];
      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return [name.text];
      return [];
    });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((el) => {
      const literal = stringLiteralValue(el);
      if (literal !== null) return [literal];
      return columnsFromArgument(el);
    });
  }
  return [];
}

function enclosingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return '<module scope>';
}

/**
 * Walks UP from a chain root through the fluent chain, collecting every
 * method call applied to the shop_subscriptions query builder.
 */
function analyzeChain(root: ts.CallExpression, file: string, src: ts.SourceFile): SubscriptionAccess {
  const methods: string[] = [];
  const columns = new Set<string>();

  let current: ts.Node = root;
  while (
    current.parent &&
    ts.isPropertyAccessExpression(current.parent) &&
    current.parent.expression === current
  ) {
    const access = current.parent;
    const method = access.name.text;
    const call = access.parent;
    if (!(call && ts.isCallExpression(call) && call.expression === access)) break;

    methods.push(method);
    if (MUTATING_METHODS.has(method) || method === 'merge') {
      for (const col of columnsFromArgument(call.arguments[0])) columns.add(col);
    }
    current = call;
  }

  const isWrite = methods.some((m) => MUTATING_METHODS.has(m));
  const columnList = [...columns].sort();
  return {
    file,
    symbol: enclosingSymbol(root),
    line: src.getLineAndCharacterOfPosition(root.getStart(src)).line + 1,
    methods,
    columns: columnList,
    isWrite,
    isAuthoritative: isWrite && columnList.some((c) => AUTHORITATIVE_COLUMNS.has(c)),
  };
}

/** Analyzes one source text. Exposed by file name so synthetic sources work. */
export function analyzeSource(file: string, sourceText: string): SubscriptionAccess[] {
  const src = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const found: SubscriptionAccess[] = [];
  const visit = (node: ts.Node) => {
    if (isTableChainRoot(node)) found.push(analyzeChain(node, file, src));
    ts.forEachChild(node, visit);
  };
  visit(src);
  return found;
}

function scanRuntime(): SubscriptionAccess[] {
  return SCAN_ROOTS.flatMap((root) =>
    listSourceFiles(root).flatMap((file) =>
      analyzeSource(file, fs.readFileSync(path.join(REPO, file), 'utf8'))
    )
  );
}

const describeAccess = (a: SubscriptionAccess) =>
  `${a.file}:${a.line} :: ${a.symbol} [${a.columns.join(', ')}]`;

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('BILL-ENTITLEMENT-01 — commercial subscription writer boundary', () => {
  const allAccesses = scanRuntime();

  // ── BOUNDARY-01 ─────────────────────────────────────────────────────────
  describe('BOUNDARY-01: entitlement-authoritative state is mutated only by the canonical service', () => {
    it('no runtime file outside the canonical transition service directly changes tier, status or billing_provider', () => {
      const violations = allAccesses
        .filter((a) => a.isAuthoritative)
        .filter((a) => a.file !== CANONICAL_SERVICE)
        .filter((a) => !EXCLUDED_PATHS.has(a.file))
        .map(describeAccess)
        .sort();

      expect(violations).toEqual([]);
    });
  });

  // ── BOUNDARY-02 ─────────────────────────────────────────────────────────
  describe('BOUNDARY-02: the canonical boundary exists as a single named file', () => {
    it('the canonical subscription transition service file is present', () => {
      expect(fs.existsSync(path.join(REPO, CANONICAL_SERVICE))).toBe(true);
    });
  });

  // ── BOUNDARY-03 ─────────────────────────────────────────────────────────
  // Guards the scanner itself. Without these, BOUNDARY-01 could pass simply
  // because the analyzer stopped detecting anything.
  describe('BOUNDARY-03: a NEW direct authoritative writer in a new runtime file is detected', () => {
    it('flags a multi-line fluent tier write in a previously unseen file', () => {
      const synthetic = `
        import type { Knex } from 'knex';
        export async function brandNewDowngrade(shopId: number, trx: Knex.Transaction) {
          await trx('shop_subscriptions')
            .where({ shop_id: shopId })
            .update({
              tier: 'starter',
              updated_at: new Date(),
            });
        }
      `;
      const found = analyzeSource('apps/backend/src/services/brand-new.service.ts', synthetic);
      expect(found).toHaveLength(1);
      expect(found[0].isWrite).toBe(true);
      expect(found[0].isAuthoritative).toBe(true);
      expect(found[0].symbol).toBe('brandNewDowngrade');
    });

    it('flags an authoritative column that only appears in an onConflict merge list', () => {
      const synthetic = `
        export async function sneakyUpsert(shopId: number, trx: any) {
          await trx('shop_subscriptions')
            .insert({ shop_id: shopId, updated_at: new Date() })
            .onConflict('shop_id')
            .merge(['status', 'updated_at']);
        }
      `;
      const found = analyzeSource('apps/backend/src/services/sneaky.service.ts', synthetic);
      expect(found).toHaveLength(1);
      expect(found[0].isAuthoritative).toBe(true);
      expect(found[0].columns).toContain('status');
    });
  });

  // ── BOUNDARY-04 ─────────────────────────────────────────────────────────
  describe('BOUNDARY-04: reads are permitted anywhere', () => {
    it('does not classify a tier read as a write', () => {
      const synthetic = `
        export async function readTier(shopId: number, trx: any) {
          const row = await trx('shop_subscriptions')
            .where({ shop_id: shopId })
            .first('tier', 'status', 'billing_provider');
          return row?.tier;
        }
      `;
      const found = analyzeSource('apps/backend/src/services/reader.service.ts', synthetic);
      expect(found).toHaveLength(1);
      expect(found[0].isWrite).toBe(false);
      expect(found[0].isAuthoritative).toBe(false);
    });

    it('classifies no read site in the runtime as an authoritative violation', () => {
      const readsFlagged = allAccesses.filter((a) => !a.isWrite && a.isAuthoritative);
      expect(readsFlagged.map(describeAccess)).toEqual([]);
    });
  });

  // ── BOUNDARY-05 ─────────────────────────────────────────────────────────
  describe('BOUNDARY-05: the known non-authoritative writers stay non-authoritative', () => {
    it.each(KNOWN_NON_AUTHORITATIVE_WRITERS)(
      '$symbol writes only $allowedColumns',
      ({ file, symbol, allowedColumns }) => {
        const writes = allAccesses.filter((a) => a.file === file && a.symbol === symbol && a.isWrite);
        expect(writes.length).toBeGreaterThanOrEqual(1);
        for (const write of writes) {
          expect(write.isAuthoritative).toBe(false);
          expect(write.columns.filter((c) => !allowedColumns.includes(c))).toEqual([]);
        }
      }
    );
  });

  // ── BOUNDARY-06 ─────────────────────────────────────────────────────────
  describe('BOUNDARY-06: the excluded paths are excluded deliberately, not vacuously', () => {
    it.each([...EXCLUDED_PATHS])('%s is a real writer that this boundary intentionally ignores', (file) => {
      const abs = path.join(REPO, file);
      expect(fs.existsSync(abs)).toBe(true);
      const found = analyzeSource(file, fs.readFileSync(abs, 'utf8'));
      // If one of these ever stops writing shop_subscriptions, the exclusion
      // is dead weight and must be re-decided rather than silently kept.
      expect(found.some((a) => a.isWrite)).toBe(true);
    });
  });
});
