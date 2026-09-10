// tests/contract/overview-live-map-commercial-access.contract.test.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-2 — TEST STRATEGY / RED
// =================================================================
// Overview Live Map currently reconstructs its Growth/Scale eligibility from
// a private `hasMapTier` tier expression instead of the canonical
// `overview.live_map` capability (Growth+; `packages/commercial-policy`
// already ships this requirement). The backend `/live-activity` route has NO
// commercial gate at all today.
//
// This file is PURE / CONTRACT layer: it reads production source as text.
// It never renders React, never touches a DB, never boots a server.
// EXPECTED RED because neither the frontend nor the backend route consumes
// the canonical mechanism yet.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const OVERVIEW_PAGE = 'apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx';
const WMS_ROUTES = 'apps/backend/src/api/wms/wms.routes.ts';

const CANONICAL_ADAPTER_MARKER = /useCommercialAccess|decideCapability|CommercialGate|evaluateAccess/;
const LEGACY_TIER_EXPR = /tier\s*===\s*'(?:scale|growth)'/;

/**
 * Explicit source slice for one top-level function: from its declaration to
 * the start of the next top-level `function` declaration (or EOF). Deliberately
 * narrower than a whole-file regex so a match can only come from THIS
 * function's own body, not an unrelated part of the file.
 */
function sliceFunction(src: string, name: string): string {
  const declRe = new RegExp(`(?:export\\s+default\\s+)?function\\s+${name}\\s*\\(`);
  const m = declRe.exec(src);
  if (!m) return '';
  const start = m.index;
  const rest = src.slice(start + m[0].length);
  const next = /\n(?:export\s+default\s+)?function\s+\w+\s*\(/.exec(rest);
  const end = next ? start + m[0].length + next.index : src.length;
  return src.slice(start, end);
}

/**
 * Bounded source slice for the `/live-activity` router registration only —
 * NOT a whole-file literal-count trick. Starts at the nearest preceding
 * `router.<verb>(` and ends at the next route registration (or the module's
 * `export default`), so a match can only come from this one route.
 */
function liveActivityRouteChunk(): string {
  const src = read(WMS_ROUTES);
  const pathIdx = src.indexOf("'/live-activity'");
  if (pathIdx === -1) return '';
  const start = src.lastIndexOf('router.', pathIdx);
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.search(/\n\nrouter\.|\nexport default/);
  return end === -1 ? rest : rest.slice(0, end);
}

// ===========================================================================
// OVLM-C1 — OverviewFT2Page consumes the shared commercial-access adapter
// ===========================================================================
describe('OVLM-C1 — OverviewFT2Page consumes canonical overview.live_map through the shared adapter', () => {
  it('EXPECTED RED: imports/uses the shared commercial-access adapter and references overview.live_map', () => {
    const src = read(OVERVIEW_PAGE);
    expect(CANONICAL_ADAPTER_MARKER.test(src)).toBe(true);
    expect(/overview\.live_map/.test(src)).toBe(true);
  });
});

/**
 * The identifier the page actually gates Live Map polling on, read off the
 * `useWmsLiveActivity(...)` call site. Deliberately name-agnostic: the
 * contract protects WHERE authority comes from, not what the local boolean
 * happens to be called (the legacy name was `hasMapTier`).
 */
function liveMapGateIdentifier(src: string): string | null {
  const callSite = /useWmsLiveActivity\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(src);
  return callSite ? callSite[1] : null;
}

/** The bounded `const <name> = ...;` initialiser for that identifier. */
function gateInitialiser(src: string, identifier: string): string | null {
  const decl = new RegExp(`const\\s+${identifier}\\s*=\\s*([^;]*)`).exec(src);
  return decl ? decl[1] : null;
}

// ===========================================================================
// OVLM-C2 — Live Map eligibility is not reconstructed from a raw tier string
// ===========================================================================
describe('OVLM-C2 — no private tier-reconstruction of Live Map eligibility', () => {
  it('EXPECTED RED: eligibility is not reconstructed from tier === growth/scale', () => {
    const src = read(OVERVIEW_PAGE);
    expect(LEGACY_TIER_EXPR.test(src)).toBe(false);
  });

  it('EXPECTED RED: the Live Map access boolean derives from the canonical decision plus its resolution signal', () => {
    // P0-A3-2 CORRECTION: this previously required a declaration literally
    // named `hasMapTier`, which froze a legacy variable name rather than the
    // authority contract. The boolean is now located behaviourally, through
    // the call site it actually gates.
    const src = read(OVERVIEW_PAGE);
    const gate = liveMapGateIdentifier(src);
    expect(gate).not.toBeNull();
    const init = gateInitialiser(src, gate as string);
    expect(init).not.toBeNull();
    expect(LEGACY_TIER_EXPR.test(init as string)).toBe(false);
    expect(/isResolved/.test(init as string)).toBe(true);
    expect(/\.allowed/.test(init as string)).toBe(true);
  });
});

// ===========================================================================
// OVLM-C3 — map eligibility/polling is driven by the canonical decision
// ===========================================================================
describe('OVLM-C3 — Live Map polling is driven by the canonical overview.live_map decision', () => {
  it('EXPECTED RED: useWmsLiveActivity is gated on a canonical decision, not the raw tier expression', () => {
    const src = read(OVERVIEW_PAGE);
    const callSite = /useWmsLiveActivity\(([^)]*)\)/.exec(src);
    expect(callSite).not.toBeNull();
    const arg = callSite ? callSite[1] : '';
    expect(LEGACY_TIER_EXPR.test(arg)).toBe(false);
    expect(/decision\.allowed|decide\(\s*['"]overview\.live_map['"]\s*\)/.test(src)).toBe(true);
  });
});

// ===========================================================================
// OVLM-C6 — floor-geometry ACQUISITION is gated by the same canonical decision
// ===========================================================================
describe('OVLM-C6 — Overview gates floor-planning acquisition on the same canonical overview.live_map decision', () => {
  it('EXPECTED RED: useFloorPlanning is called with the same gate identifier that gates useWmsLiveActivity', () => {
    // A denied tenant must not fetch real floor geometry at all. Hiding the
    // rendered map while still issuing GET /api/v1/floor-planning/layout would
    // satisfy the render-level tests and still leak the gated resource, so the
    // durable contract is that BOTH acquisitions read one decision.
    const src = read(OVERVIEW_PAGE);
    const gate = liveMapGateIdentifier(src);
    expect(gate).not.toBeNull();

    const floorCallSite = /useFloorPlanning\(([^)]*)\)/.exec(src);
    expect(floorCallSite).not.toBeNull();
    expect((floorCallSite as RegExpExecArray)[1].trim()).toBe(gate);
  });
});

// ===========================================================================
// OVLM-C4 — teaser required-tier metadata derives from the AccessDecision
// ===========================================================================
describe('OVLM-C4 — denied shared teaser derives required-tier metadata from AccessDecision', () => {
  it('uses the canonical decision in the denied map slot without a local Growth requirement', () => {
    const src = read(OVERVIEW_PAGE);
    expect(src).toMatch(/const\s+liveMapDecision\s*=\s*decide\(\s*['"]overview\.live_map['"]\s*\)/);

    const deniedSlot = /if\s*\(\s*!hasMapAccess\s*\)\s*\{([\s\S]*?)\}\s*else/.exec(src)?.[1];
    expect(deniedSlot).toBeDefined();
    expect(deniedSlot).toMatch(/mapContent\s*=\s*\(\s*<LiveMapTeaser\b/);
    // A null fallback preserves the decision's tier when present and supplies
    // neutral teaser wording when the decision carries no required tier.
    expect(deniedSlot).toMatch(/requiredTier\s*=\s*\{\s*liveMapDecision\.requiredTier\s*(?:\?\?\s*null\s*)?\}/);
    expect(src).toMatch(/import\s*\{\s*LiveMapTeaser\s*\}\s*from\s*['"]components\/LiveMapTeaser['"]/);
    expect(src).not.toMatch(/\brequiredTier\s*(?:=\s*\{?\s*|:\s*)['"`]growth['"`]/);
  });
});

// ===========================================================================
// OVLM-C5 — backend /live-activity route requires overview.live_map
// ===========================================================================
describe('OVLM-C5 — wms.routes.ts GET /live-activity requires overview.live_map', () => {
  it('EXPECTED RED: the bounded route registration includes requireCapability(\'overview.live_map\')', () => {
    const chunk = liveActivityRouteChunk();
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireCapability\(\s*'overview\.live_map'\s*\)/.test(chunk)).toBe(true);
  });

  it('GREEN CONTROL: requireAction(\'wms:read\') RBAC is preserved, not weakened', () => {
    const chunk = liveActivityRouteChunk();
    expect(chunk.length).toBeGreaterThan(0);
    expect(/requireAction\(\s*'wms:read'\s*\)/.test(chunk)).toBe(true);
  });
});
