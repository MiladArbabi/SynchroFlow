import fs from 'fs';
import path from 'path';

type RouteRegistration = {
  handlerSymbol: string;
  file: string;
  line: number;
  middlewareChain: string[];
};

const ROUTES_ROOT = path.join(process.cwd(), 'apps/backend/src/api');
const ROUTER_CALL = /router\.(get|post|patch|put|delete)\s*\(/g;
// P0-A3-4: `requireCapability` is the CANONICAL commercial marker — the shared
// capability gate that replaced raw tier checks. Without it here the parser read
// a correctly-gated canonical chain as [], i.e. "no entitlement middleware at
// all", which is the opposite of the truth. `requireTier`/`tierHasFlag` remain
// recognised while legacy gates still exist elsewhere.
const ENTITLEMENT_MARKERS = [
  'requireCapability',
  'requireTier',
  'requireAction',
  'tierHasFlag',
];

function listRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.routes.ts') ? [fullPath] : [];
  });
}

function lineForOffset(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function findCallEnd(source: string, openParen: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaping = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openParen; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error('Unclosed router registration');
}

function splitTopLevelArgs(args: string): string[] {
  const result: string[] = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaping = false;

  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];

    if (quote) {
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === ',' && paren === 0 && bracket === 0 && brace === 0) {
      result.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }

  result.push(args.slice(start).trim());
  return result.filter(Boolean);
}

function normalizeEntitlement(arg: string): string | null {
  if (!ENTITLEMENT_MARKERS.some((marker) => arg.includes(marker))) return null;
  return arg.replace(/\s+/g, ' ');
}

function parseRouteFile(file: string): RouteRegistration[] {
  const source = fs.readFileSync(file, 'utf8');
  const registrations: RouteRegistration[] = [];
  let match: RegExpExecArray | null;

  while ((match = ROUTER_CALL.exec(source))) {
    const openParen = source.indexOf('(', match.index);
    const closeParen = findCallEnd(source, openParen);
    const args = splitTopLevelArgs(source.slice(openParen + 1, closeParen));
    const handlerSymbol = args[args.length - 1]?.replace(/\s+/g, ' ') ?? '';

    registrations.push({
      handlerSymbol,
      file: path.relative(process.cwd(), file),
      line: lineForOffset(source, match.index),
      middlewareChain: args.slice(1, -1).map(normalizeEntitlement).filter((value): value is string => Boolean(value)),
    });

    ROUTER_CALL.lastIndex = closeParen + 1;
  }

  return registrations;
}

describe('CONTRACT-ENT-MOUNT-02 entitlement mount consistency', () => {
  it('does not register the same handler behind divergent entitlement chains', () => {
    const registrations = listRouteFiles(ROUTES_ROOT).flatMap(parseRouteFile);
    const byHandler = new Map<string, RouteRegistration[]>();

    for (const registration of registrations) {
      const existing = byHandler.get(registration.handlerSymbol) ?? [];
      existing.push(registration);
      byHandler.set(registration.handlerSymbol, existing);
    }

    const duplicateSet = [...byHandler.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([handlerSymbol, entries]) => ({ handlerSymbol, entries }));

    console.log('CONTRACT-ENT-MOUNT-02_DUPLICATES', JSON.stringify(duplicateSet, null, 2));

    // ------------------------------------------------------------------
    // Products operator-summary is mounted behind BOTH aliases. What matters
    // is (a) both owner files still mount it and (b) each does so behind the
    // canonical commercial capability — never WHERE in the file that happens.
    //
    // The previous version pinned `line: 28` / `line: 24`. Those numbers are
    // not contractual: any comment or import edit above the route moved them,
    // so the assertion failed on legitimate source changes while proving
    // nothing about commercial policy. Ownership + chain content are the real
    // invariant, and they are asserted directly below.
    // ------------------------------------------------------------------
    const productsSummaryEntries = byHandler.get('getProductsOperatorSummaryHandler') ?? [];

    expect(productsSummaryEntries.map((entry) => entry.file).sort()).toEqual([
      'apps/backend/src/api/products/products.ft2.routes.ts',
      'apps/backend/src/api/products/products.routes.ts',
    ]);

    console.log(
      'CONTRACT-ENT-MOUNT-02_PRODUCTS_SUMMARY',
      JSON.stringify(productsSummaryEntries, null, 2)
    );

    // Every mount of this handler must carry the canonical Inventory capability.
    // Asserted per entry so a failure names the offending file.
    for (const entry of productsSummaryEntries) {
      expect({
        file: entry.file,
        hasInventoryCore: entry.middlewareChain.some((middleware) =>
          /requireCapability\(\s*'inventory\.core'\s*\)/.test(middleware)
        ),
      }).toEqual({ file: entry.file, hasInventoryCore: true });
    }

    const violations = duplicateSet.filter(({ entries }) => {
      const uniqueChains = new Set(entries.map((entry) => JSON.stringify(entry.middlewareChain)));
      return uniqueChains.size > 1;
    });

    expect(violations).toEqual([]);
  });
});
