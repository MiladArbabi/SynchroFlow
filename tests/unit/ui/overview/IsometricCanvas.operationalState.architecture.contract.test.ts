// tests/unit/ui/overview/IsometricCanvas.operationalState.architecture.contract.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice C — REQUIRED architecture/static contract.
//
// The shared IsometricCanvas renderer must only PAINT an explicit,
// caller-supplied OperationalMapState — it must never import Overview's own
// business-interpretation module, Ops Console, WMS domain services, or any
// SLA/threshold logic. Plain source-text scan, matching this repo's existing
// *-architecture.contract.test.ts convention (AST is not needed here).

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SHARED_RENDERER_FILES = [
  'modules/shared/src/ui/IsometricCanvas.tsx',
  'modules/shared/src/ui/IsometricCanvas.types.ts',
];

function readSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[EXPECTED] ${relPath} must exist — canonical shared IsometricCanvas file.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

describe('shared IsometricCanvas — operational-state architecture boundary', () => {
  describe.each(SHARED_RENDERER_FILES)('%s', (relPath) => {
    it('does not import Overview-owned operational-state business logic', () => {
      // Import/require specifiers and direct symbol usage only. A doc comment
      // may legitimately NAME the sibling Overview file for documentation
      // (e.g. this file's own "structurally identical to Overview's own
      // OverviewOperationalState" note) without importing or calling it.
      const source = readSource(relPath);
      const importSpecifierPattern = /(?:from\s+|require\()\s*['"][^'"]*overviewOperationalState/;
      const directCallPattern = /\b(deriveLocationOperationalState|deriveStationOperationalState|resolveOverviewOperationalState)\s*\(/;
      expect(source).not.toMatch(importSpecifierPattern);
      expect(source).not.toMatch(directCallPattern);
    });

    it('does not import Ops Console', () => {
      const source = readSource(relPath);
      expect(source).not.toMatch(/OpsConsole/);
    });

    it('does not import WMS domain services or SLA/threshold-evaluation logic', () => {
      // Import/require specifiers only. Pre-existing doc comments elsewhere in
      // this file may legitimately name a WMS field (e.g. LiveBinActivity's
      // idle_alert_threshold_minutes) to explain where a value comes from —
      // that is not a business-logic import and must not fail this contract.
      const source = readSource(relPath);
      const importSpecifierPattern =
        /(?:from\s+|require\()\s*['"][^'"]*(services\/wms\/|wmsLiveActivity|barcodeResolution|receiveJob\.service|slaBreach|sla_breach)/i;
      expect(source).not.toMatch(importSpecifierPattern);
    });

    it('does not import any Overview page module', () => {
      // Matches actual import/require specifiers only — explanatory doc
      // comments that merely reference the Overview file path by name
      // (e.g. this file's own contract description) are not imports.
      const source = readSource(relPath);
      const importSpecifierPattern = /(?:from\s+|require\()\s*['"][^'"]*pages\/(overview\/|ft2-pages\/OverviewFT2Page)/;
      expect(source).not.toMatch(importSpecifierPattern);
    });
  });

  it('defines OperationalMapState as its own structural union, not an import of OverviewOperationalState', () => {
    const typesSource = readSource('modules/shared/src/ui/IsometricCanvas.types.ts');
    expect(typesSource).toMatch(
      /export type OperationalMapState\s*=\s*\n?\s*\|?\s*'neutral'/
    );
    expect(typesSource).not.toMatch(/import[^;]*OverviewOperationalState/);
  });
});
