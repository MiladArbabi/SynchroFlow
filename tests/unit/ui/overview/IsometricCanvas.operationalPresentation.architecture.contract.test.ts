// tests/unit/ui/overview/IsometricCanvas.operationalPresentation.architecture.contract.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice D — REQUIRED architecture/static contract.
//
// The shared IsometricCanvas renderer must only PAINT an already-resolved
// badge primitive — it must never import Overview's own business-
// interpretation module (badge/reason selection), Ops Console, WMS domain
// services, or any SLA/threshold logic. It must also carry no reason-
// selection logic of its own, and the presentation type it accepts must
// stay a primitive (label/count), never the richer Overview domain shape
// (reason/workLines/impactLines/recencyLine). Plain source-text scan,
// matching this repo's existing *-architecture.contract.test.ts convention.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SHARED_RENDERER_FILES = [
  'modules/shared/src/ui/IsometricCanvas.tsx',
  'modules/shared/src/ui/IsometricCanvas.types.ts',
];
const OVERVIEW_PRESENTATION_FILE = 'apps/frontend/src/pages/overview/overviewOperationalState.ts';

function readSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[EXPECTED] ${relPath} must exist.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

describe('shared IsometricCanvas — Slice D presentation architecture boundary', () => {
  describe.each(SHARED_RENDERER_FILES)('%s', (relPath) => {
    it('does not import Overview-owned presentation/business logic', () => {
      const source = readSource(relPath);
      const importSpecifierPattern =
        /(?:from\s+|require\()\s*['"][^'"]*(overviewOperationalState|pages\/(overview\/|ft2-pages\/OverviewFT2Page))/;
      const directCallPattern =
        /\b(deriveLocationOperationalState|deriveStationOperationalState|resolveOverviewOperationalState|deriveLocationOperationalPresentation|deriveStationOperationalPresentation)\s*\(/;
      expect(source).not.toMatch(importSpecifierPattern);
      expect(source).not.toMatch(directCallPattern);
    });

    it('does not import Ops Console or WMS domain services', () => {
      const source = readSource(relPath);
      expect(source).not.toMatch(/OpsConsole/);
      const wmsImportPattern =
        /(?:from\s+|require\()\s*['"][^'"]*(services\/wms\/|wmsLiveActivity|barcodeResolution|receiveJob\.service)/i;
      expect(source).not.toMatch(wmsImportPattern);
    });

    it('contains no hardcoded merchant reason/badge wording (that authorship stays in Overview)', () => {
      // These are the exact Overview-owned reason strings from
      // overviewOperationalState.ts — if any of them ever appear in the
      // shared renderer, badge/reason authorship has leaked out of Overview.
      const source = readSource(relPath);
      const overviewOwnedReasons = [
        'Open warehouse issue',
        'Operator activity has gone stale',
        'Operators active',
        'Awaiting stow',
        'At receiving dock',
        'Blocked orders need attention',
        'Orders ready for release',
        'Packed orders awaiting pickup',
        'Orders shipped today',
      ];
      for (const reason of overviewOwnedReasons) {
        expect(source).not.toContain(reason);
      }
    });
  });

  it('shared OperationalMapPresentation stays a primitive: no reason/workLines/impactLines/recencyLine fields', () => {
    const typesSource = readSource('modules/shared/src/ui/IsometricCanvas.types.ts');
    const presentationBlockMatch = typesSource.match(
      /export interface OperationalMapPresentation \{[\s\S]*?\n\}/
    );
    expect(presentationBlockMatch).not.toBeNull();
    const block = presentationBlockMatch![0];
    expect(block).not.toMatch(/\breason\b/);
    expect(block).not.toMatch(/\bworkLines\b/);
    expect(block).not.toMatch(/\bimpactLines\b/);
    expect(block).not.toMatch(/\brecencyLine\b/);
    // It DOES carry state + primaryBadge — the two primitives the renderer needs.
    expect(block).toMatch(/\bstate\b/);
    expect(block).toMatch(/\bprimaryBadge\b/);
  });

  it('badge reason/priority selection lives in Overview-owned code, not the renderer', () => {
    // The renderer must never branch on a raw count to CHOOSE a badge — it
    // only reads the already-resolved primaryBadge object. (staleOperatorCount
    // itself is legitimate pre-Slice-D renderer state for an unrelated
    // operator-dot aria-label — see OV-132 — so only the badge-selection
    // pattern is asserted here, not that identifier in isolation.)
    const rendererSource = readSource('modules/shared/src/ui/IsometricCanvas.tsx');
    expect(rendererSource).not.toMatch(/problemCount > 0[\s\S]{0,40}primaryBadge/);
    expect(rendererSource).not.toMatch(/stowUnits > 0[\s\S]{0,40}primaryBadge/);
    expect(rendererSource).not.toMatch(/dockUnits > 0[\s\S]{0,40}primaryBadge/);

    // Confirm the reverse: Overview's presentation file DOES own exactly
    // this precedence chain (problem > stale > active > stow > dock).
    const overviewSource = readSource(OVERVIEW_PRESENTATION_FILE);
    expect(overviewSource).toMatch(/inputs\.problemCount > 0/);
    expect(overviewSource).toMatch(/inputs\.staleOperatorCount > 0/);
    expect(overviewSource).toMatch(/inputs\.operatorCount > 0/);
    expect(overviewSource).toMatch(/inputs\.stowUnits > 0/);
    expect(overviewSource).toMatch(/inputs\.dockUnits > 0/);
  });
});
