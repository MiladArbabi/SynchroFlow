// tests/contract/wms-analytics-v1-surface.contract.test.ts
//
// GH-1231 — Analytics V1 owner-surface contract (CI-gated, static, DB-free).
//
// Ratified target: Concept A, Visual Four Questions
// (docs/blueprints/WarehouseAnalyticsModule.md §12B; playbook §18B).
//
// Scope is deliberately narrow: the OWNER SURFACE is WmsAnalyticsPage.tsx plus
// every app-local module it imports (relative or src alias, anywhere under
// apps/frontend/src) that is OWNED by Analytics — i.e. imported only from the
// owner surface itself. Ownership is decided by the import graph, not by a
// directory: an Analytics component under components/ is policed; a shared
// module that any other screen also imports (CommercialGate, layout, design
// system) is not. EXCLUDED: the shared data layer (useWmsAnalytics.ts,
// analyticsAvailability.ts), whose types/validators legitimately keep legacy
// response fields, and the unchanged Floor Display. Workspace packages
// (@lasyncro/*, modules/*, packages/*) are shared by construction and are not
// walked. Legacy API fields remain valid for the Floor Display and other consumers.
//
// This file keeps only focused STATIC SOURCE safeguards: retired fields/copy
// absent from owner components, no /wms/problem-center link, no page-root
// overflowY auto, and GH-1230 resolver / hook / commercial-gate wiring.
//
// ASSIGNED TO THE FRONTEND RTL RED SUITE (planned
// tests/unit/ui/wms/WmsAnalyticsPage.v1.test.tsx, non-vacuous — a missing
// label fails, never skips): static occurrence is not proof of rendering, so
// these are asserted there against the rendered page, independent of source
// location or JSX spelling —
//   - the five rendered regions (Pace, Flow, Problems, Team, Costs) and the
//     certification workspace marker (U6);
//   - the four ratified question headings;
//   - drilldown routes /problem-center, /orders/flow, /team as real links;
//   - Details / selection interactions;
//   - the role-denial sentence and commercial UpgradePrompt rendering (D3).

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'apps/frontend/src');
const PAGES_ROOT = path.join(SRC_ROOT, 'pages');
const PAGE = path.join(PAGES_ROOT, 'ft2-pages/WmsAnalyticsPage.tsx');
const DISPLAY_PAGE = path.join(PAGES_ROOT, 'display/WmsDisplayPage.tsx');

/** Shared data layer — may legitimately name legacy fields; not owner-surface copy. */
const SHARED_DATA_LAYER = new Set([
  path.join(PAGES_ROOT, 'wms/useWmsAnalytics.ts'),
  path.join(PAGES_ROOT, 'wms/analyticsAvailability.ts'),
]);
const NOT_WALKED = new Set([...SHARED_DATA_LAYER, DISPLAY_PAGE]);

/** Strip comments so explanatory history cannot make an assertion pass or fail (GH-1147 precedent). */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

function resolveFile(base: string): string | null {
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Relative specifiers and the app's src aliases (vite/tsconfig: components/, hooks/, …). Packages are not walked. */
function resolveAppImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith('.')) return resolveFile(path.resolve(path.dirname(fromFile), spec));
  const [head] = spec.split('/');
  if (head.startsWith('@') || (!fs.existsSync(path.join(SRC_ROOT, head)) && !fs.existsSync(path.join(SRC_ROOT, `${head}.ts`)))) return null;
  return resolveFile(path.join(SRC_ROOT, spec));
}

function appSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : appSourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [full] : [];
  });
}

/**
 * Owned closure: start from everything reachable from `root`, then repeatedly
 * drop any module (other than root) imported by a file outside the set, or no
 * longer reachable from root inside the set. Location-independent.
 */
function ownedClosure(root: string, importsOf: Map<string, string[]>): Set<string> {
  const importersOf = new Map<string, Set<string>>();
  for (const [from, tos] of importsOf) for (const to of tos) {
    if (!importersOf.has(to)) importersOf.set(to, new Set());
    importersOf.get(to)!.add(from);
  }
  const reachableWithin = (allowed: Set<string>) => {
    const seen = new Set<string>([root]);
    const queue = [root];
    while (queue.length) for (const to of importsOf.get(queue.shift()!) ?? []) {
      if (allowed.has(to) && !seen.has(to)) { seen.add(to); queue.push(to); }
    }
    return seen;
  };
  let owned = reachableWithin(new Set(importsOf.keys()));
  for (let changed = true; changed;) {
    const kept = new Set([...owned].filter((f) => f === root || [...(importersOf.get(f) ?? [])].every((i) => owned.has(i))));
    const next = reachableWithin(kept);
    changed = next.size !== owned.size;
    owned = next;
  }
  return owned;
}

function appImportGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of appSourceFiles(SRC_ROOT)) {
    if (NOT_WALKED.has(file)) { graph.set(file, []); continue; }
    const src = codeOnly(fs.readFileSync(file, 'utf8'));
    const targets = [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)]
      .map((m) => resolveAppImport(file, m[1]))
      .filter((t): t is string => t !== null && !NOT_WALKED.has(t));
    graph.set(file, targets);
  }
  return graph;
}

const graph = appImportGraph();
const surfaceFiles = [...ownedClosure(PAGE, graph)];
const surface = surfaceFiles.map((f) => codeOnly(fs.readFileSync(f, 'utf8'))).join('\n');
const pageCode = codeOnly(fs.readFileSync(PAGE, 'utf8'));

describe('GH-1231 V1 surface — page scroll ownership', () => {
  it('the page root is not an inner scrolling workspace (§12B.2)', () => {
    expect(pageCode).not.toMatch(/overflowY\s*:\s*['"]auto['"]/);
  });
});

describe('GH-1231 V1 surface — no non-existent drilldown', () => {
  it('never links to the non-existent /wms/problem-center', () => {
    expect(surface).not.toMatch(/\/wms\/problem-center/);
  });
});

describe('GH-1231 V1 surface — GH-1230 availability and denial preserved', () => {
  it('resolves availability through the V1 per-block resolvers and page-level denial', () => {
    expect(surface).toMatch(/\bresolveV1HistoricalBlocks\b/);
    expect(surface).toMatch(/\bresolveV1LiveBlocks\b/);
    expect(surface).toMatch(/\bresolveAnalyticsDenial\b/);
  });

  it('keeps the hook-local retry hooks (D6) and the independent Core commercial gate', () => {
    expect(surface).toMatch(/\buseWmsAnalytics\s*\(/);
    expect(surface).toMatch(/\buseLiveCapacity\s*\(/);
    expect(surface).toMatch(/\bCommercialGate\b/);
    expect(surface).toMatch(/['"`]warehouse\.analytics['"`]/);
  });

  it('keeps the canonical commercial denial component (D3)', () => {
    expect(surface).toMatch(/\bUpgradePrompt\b/);
  });

  it('keeps Cast to the unchanged Floor Display', () => {
    expect(surface).toMatch(/\bCastButton\b|\/wms\/analytics\/display/);
  });
});

describe('GH-1231 V1 surface — retired misleading claims are absent from the owner surface', () => {
  const RETIRED_FIELDS: [string, RegExp][] = [
    ['live_uph', /\blive_uph\b/],
    ['required_uph', /\brequired_uph\b/],
    ['standard_uph', /\bstandard_uph\b/],
    ['on_track', /\bon_track\b/],
    ['avg_uph / latest_uph / .uph', /\bavg_uph\b|\blatest_uph\b|\.uph\b/],
    ['accuracy_pct', /\baccuracy_pct\b/],
    ['heat_grid', /\bheat_grid\b/],
    ['cost values / editorial / exception_cost', /\bcost_per_order\b|\bcost_per_unit\b|\btotal_cost\b|\bexception_cost\b|\beditorial\b/],
    ['WMS/legacy shipped split', /\bshipped_via_wms\b|\bshipped_via_legacy\b/],
    ['operators_on_shift', /\boperators_on_shift\b/],
    ['historical stage averages (U8)', /\breleased_to_picking_s\b|\bpicking_s\b|\bpacking_s\b|\bpacked_to_shipped_s\b|pipeline\??\.stages/],
    ['receive/return latencies', /\breceive_to_pickable\w*|\breturn_to_restock\w*/],
    ['historical aging_wip as Flow ages', /\baging_wip\b/],
    ['legacy throughput_trend / exception_trend / top_skus', /\bthroughput_trend\b|\bexception_trend\b|\btop_skus\b/],
    ['legacy operators rows', /\.operators\b/],
  ];

  it.each(RETIRED_FIELDS)('does not read %s', (_name, pattern) => {
    expect(surface).not.toMatch(pattern);
  });

  const RETIRED_COPY: [string, RegExp][] = [
    ['UPH', /\bUPH\b/],
    ['vs self / vs team', /vs\.? self|vs\.? team/i],
    ['On track', /\bon track\b|\bat risk\b/i],
    ['Accuracy', /\baccuracy\b/i],
    ['Exceptions (merchant copy is Problems)', /['">`]\s*Exceptions?\b/],
    ['Pipeline Stage Velocity', /Pipeline Stage Velocity/i],
    ['Stuck on the floor', /Stuck on the floor/i],
    ['Usually / bottleneck', /\bUsually\b|\bbottleneck\b/i],
    ['working now / on shift', /working now|on shift/i],
    ['Not enough in bin (inferred cause)', /not enough in bin/i],
    ['vs / previous period comparisons', /last period|previous period|vs last/i],
  ];

  it.each(RETIRED_COPY)('does not say "%s"', (_name, pattern) => {
    expect(surface).not.toMatch(pattern);
  });
});

describe('GH-1231 V1 surface — scope guard: Floor Display is unchanged and out of scope', () => {
  const display = codeOnly(fs.readFileSync(DISPLAY_PAGE, 'utf8'));

  it('the Floor Display still consumes its legacy payload (not policed by this contract)', () => {
    expect(display).toMatch(/\btop_skus\b/);
    expect(display).toMatch(/\blive_uph\b/);
  });

  it('the owner surface walk excludes the Floor Display and the shared data layer', () => {
    expect(surfaceFiles).toContain(PAGE);
    expect(surfaceFiles).not.toContain(DISPLAY_PAGE);
    for (const shared of SHARED_DATA_LAYER) expect(surfaceFiles).not.toContain(shared);
  });

  it('every policed module other than the page is imported only from the owner surface', () => {
    const owned = new Set(surfaceFiles);
    const rel = (f: string) => path.relative(REPO_ROOT, f);
    const leaks = [...graph].flatMap(([from, targets]) => (owned.has(from)
      ? []
      : targets.filter((t) => t !== PAGE && owned.has(t)).map((t) => `${rel(from)} → ${rel(t)}`)));
    expect(leaks).toEqual([]);
  });
});

describe('GH-1231 V1 surface — owner walk is location-independent (synthetic graph)', () => {
  const g = new Map<string, string[]>([
    ['page', ['components/analytics/PaceRegion', 'pages/wms/FlowRegion', 'components/CommercialGate']],
    ['components/analytics/PaceRegion', ['components/analytics/PaceBars', 'components/analytics/Cycle']],
    ['components/analytics/Cycle', ['components/analytics/PaceRegion']],
    ['components/analytics/PaceBars', []],
    ['pages/wms/FlowRegion', []],
    ['components/CommercialGate', ['components/GateInner']],
    ['components/GateInner', []],
    ['pages/OtherPage', ['components/CommercialGate']],
  ]);
  const owned = ownedClosure('page', g);

  it('polices Analytics-only modules wherever they live, including import cycles', () => {
    for (const f of ['page', 'components/analytics/PaceRegion', 'components/analytics/PaceBars', 'components/analytics/Cycle', 'pages/wms/FlowRegion']) {
      expect(owned).toContain(f);
    }
  });

  it('does not police a module another screen imports, nor what is reachable only through it', () => {
    expect(owned).not.toContain('components/CommercialGate');
    expect(owned).not.toContain('components/GateInner');
  });
});
