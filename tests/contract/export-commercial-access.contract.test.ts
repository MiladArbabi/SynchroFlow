// tests/contract/export-commercial-access.contract.test.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A3-1 — TEST STRATEGY / RED
// =================================================================
// Export/report commercial access currently has THREE independent
// authorities instead of one:
//   1. apps/frontend/src/config/exportReports.ts    — private TIER_ORDER +
//      isTierSufficient() + per-report `tier` field
//   2. apps/frontend/src/components/ExportDrawer.tsx and
//      apps/frontend/src/pages/ft2-pages/ShopSettingsReportsPage.tsx —
//      independently call isTierSufficient(userTier, report.tier)
//   3. apps/frontend/src/components/ColumnPicker.tsx — independently calls
//      usePlanEntitlement().can('exports.column_selection') /
//      .mustUpgradeTo('exports.column_selection')
//   4. apps/backend/src/api/exports/exports.routes.ts — requireTier('core'),
//      not requireCapability('exports.core')
//   5. apps/backend/src/api/exports/exports.controller.ts — bespoke
//      tierHasFlag(tier, 'exports.column_selection') decision, independent
//      of the canonical exports.column_selection capability
//
// Ratified target (per this brief): standard export/report download ->
// capabilityId 'exports.core' (Core+); advanced column selection ->
// capabilityId 'exports.column_selection' (Growth+). Both already exist in
// packages/commercial-policy/src/capabilities.ts. No per-report capability
// differentiation exists or is being invented here — every active
// QUICK_REPORTS entry is a standard 'exports.core' export.
//
// This file is PURE / CONTRACT layer: it reads production source as text.
// It never renders React, never touches a DB, never boots a server.
// EXPECTED RED because none of the five files above route through the
// shared canonical mechanism yet.
//
// NOTE ON THE EXISTING P0-A2B BOUNDARY: tests/contract/commercial-access-policy.contract.test.ts
// (B16/B17) currently asserts exportReports.ts + usePlanEntitlement.ts are
// the exact PERMITTED deferred P0-A3 residuals — i.e. it currently asserts
// exportReports.ts DOES carry a private TIER_ORDER. That assertion is
// correct and GREEN today (source is unchanged) and is intentionally left
// untouched by this RED-only phase; it will need updating at IMPLEMENT time
// alongside the actual source change, not here.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const EXPORT_REPORTS = 'apps/frontend/src/config/exportReports.ts';
const EXPORT_DRAWER = 'apps/frontend/src/components/ExportDrawer.tsx';
const SHOP_SETTINGS_REPORTS = 'apps/frontend/src/pages/ft2-pages/ShopSettingsReportsPage.tsx';
const COLUMN_PICKER = 'apps/frontend/src/components/ColumnPicker.tsx';
const EXPORTS_ROUTES = 'apps/backend/src/api/exports/exports.routes.ts';
const EXPORTS_CONTROLLER = 'apps/backend/src/api/exports/exports.controller.ts';

const LOCAL_TIER_ORDER = /^\s*(?:export\s+)?const\s+TIER_ORDER\b/m;
const CANONICAL_ADAPTER_MARKER = /useCommercialAccess|decideCapability|CommercialGate|evaluateAccess/;
// Proves the consumer resolves eligibility through the registry-owned
// capability identifier rather than duplicating the 'exports.core' literal
// locally. C1 already proves the registry declares that literal; this marker
// proves ExportDrawer/ShopSettingsReportsPage merely consume it by reference.
const CAPABILITY_ID_CONSUMPTION_MARKER = /\breport\.capabilityId\b/;

// ===========================================================================
// A3E-C1 — exportReports.ts has no commercial tier authority
// ===========================================================================
describe('A3E-C1 — exportReports.ts is not a commercial-tier authority', () => {
  it('EXPECTED RED: no private TIER_ORDER map', () => {
    expect(LOCAL_TIER_ORDER.test(read(EXPORT_REPORTS))).toBe(false);
  });

  it('EXPECTED RED: no isTierSufficient() access-authority function', () => {
    expect(/function\s+isTierSufficient\s*\(/.test(read(EXPORT_REPORTS))).toBe(false);
  });

  it('EXPECTED RED: active report definitions identify the canonical exports.core capability', () => {
    // Not asserting a specific property name (e.g. "capabilityId:") — only
    // that the file identifies its access requirement through the
    // canonical exports.core capability, directly or via one shared
    // mechanism, somewhere in the file.
    expect(/exports\.core/.test(read(EXPORT_REPORTS))).toBe(true);
  });
});

// ===========================================================================
// A3E-C2 — ExportDrawer uses canonical commercial access
// ===========================================================================
describe('A3E-C2 — ExportDrawer uses canonical commercial access', () => {
  it('EXPECTED RED: does not import/use isTierSufficient', () => {
    expect(/isTierSufficient/.test(read(EXPORT_DRAWER))).toBe(false);
  });

  it('EXPECTED RED: does not reconstruct eligibility from a private tier-rank map', () => {
    expect(LOCAL_TIER_ORDER.test(read(EXPORT_DRAWER))).toBe(false);
  });

  it('EXPECTED RED: resolves standard export access through the shared commercial-access adapter, consuming report.capabilityId (not userTier/report.tier)', () => {
    const src = read(EXPORT_DRAWER);
    expect(CANONICAL_ADAPTER_MARKER.test(src)).toBe(true);
    expect(CAPABILITY_ID_CONSUMPTION_MARKER.test(src)).toBe(true);
    expect(/\buserTier\b/.test(src)).toBe(false);
    expect(/\breport\.tier\b/.test(src)).toBe(false);
  });
});

// ===========================================================================
// A3E-C3 — ShopSettingsReportsPage uses canonical commercial access
// ===========================================================================
describe('A3E-C3 — ShopSettingsReportsPage (Reports Hub) uses canonical commercial access', () => {
  it('EXPECTED RED: does not import/use isTierSufficient', () => {
    expect(/isTierSufficient/.test(read(SHOP_SETTINGS_REPORTS))).toBe(false);
  });

  it('EXPECTED RED: does not reconstruct eligibility from a private tier-rank map', () => {
    expect(LOCAL_TIER_ORDER.test(read(SHOP_SETTINGS_REPORTS))).toBe(false);
  });

  it('EXPECTED RED: consumes report.capabilityId through the shared commercial-access adapter (not userTier/report.tier)', () => {
    const src = read(SHOP_SETTINGS_REPORTS);
    expect(CANONICAL_ADAPTER_MARKER.test(src)).toBe(true);
    expect(CAPABILITY_ID_CONSUMPTION_MARKER.test(src)).toBe(true);
    expect(/\buserTier\b/.test(src)).toBe(false);
    expect(/\breport\.tier\b/.test(src)).toBe(false);
  });
});

// ===========================================================================
// A3E-C4 — ColumnPicker uses canonical column-selection capability
// ===========================================================================
describe('A3E-C4 — ColumnPicker uses canonical column-selection capability', () => {
  it('EXPECTED RED: does not import/use usePlanEntitlement', () => {
    expect(/usePlanEntitlement/.test(read(COLUMN_PICKER))).toBe(false);
  });

  it('EXPECTED RED: does not call mustUpgradeTo() for a legacy denial tier', () => {
    expect(/mustUpgradeTo\s*\(/.test(read(COLUMN_PICKER))).toBe(false);
  });

  it('EXPECTED RED: consumes exports.column_selection through the shared commercial-access adapter', () => {
    const src = read(COLUMN_PICKER);
    expect(CANONICAL_ADAPTER_MARKER.test(src)).toBe(true);
    expect(/exports\.column_selection/.test(src)).toBe(true);
  });
});

// ===========================================================================
// A3E-C5 — backend export routes use exports.core
// ===========================================================================
describe('A3E-C5 — exports.routes.ts uses requireCapability(exports.core)', () => {
  const src = read(EXPORTS_ROUTES);

  it('EXPECTED RED: no requireTier(...) commercial enforcement remains', () => {
    expect(/requireTier\s*\(/.test(src)).toBe(false);
  });

  it('EXPECTED RED: every active export route uses requireCapability(\'exports.core\')', () => {
    const routeBlocks = [
      ...src.matchAll(
        /router\.(?:get|post)\(\s*['"][^'"]+['"][\s\S]*?\n\);/g
      ),
    ].map((match) => match[0]);

    expect(routeBlocks.length).toBeGreaterThan(0);

    for (const routeBlock of routeBlocks) {
      expect(routeBlock).toMatch(
        /requireCapability\(\s*['"]exports\.core['"]\s*\)/
      );
    }
  });

  it('GREEN CONTROL: every active export route preserves exports:read RBAC', () => {
    const routeBlocks = [
      ...src.matchAll(
        /router\.(?:get|post)\(\s*['"][^'"]+['"][\s\S]*?\n\);/g
      ),
    ].map((match) => match[0]);

    expect(routeBlocks.length).toBeGreaterThan(0);

    for (const routeBlock of routeBlocks) {
      expect(routeBlock).toMatch(
        /requireAction\(\s*['"]exports:read['"]\s*\)/
      );
    }
  });
});

// ===========================================================================
// A3E-C6 — custom-column backend decision is canonical
// ===========================================================================
describe('A3E-C6 — exports.controller.ts column-selection decision is canonical', () => {
  const src = read(EXPORTS_CONTROLLER);

  it('EXPECTED RED: does not independently decide column-selection access with tierHasFlag(...)', () => {
    expect(/tierHasFlag\s*\(/.test(src)).toBe(false);
  });

  it('EXPECTED RED: does not own a second private tier/feature policy (no local TIER_ORDER)', () => {
    expect(LOCAL_TIER_ORDER.test(src)).toBe(false);
  });

  it('EXPECTED RED: the filters.columns decision path references the canonical exports.column_selection capability via the shared engine', () => {
    expect(/exports\.column_selection/.test(src)).toBe(true);
    expect(/@lasyncro\/commercial-policy|evaluateAccess|CAPABILITY_REQUIREMENTS|requireCapability/.test(src)).toBe(true);
  });
});
