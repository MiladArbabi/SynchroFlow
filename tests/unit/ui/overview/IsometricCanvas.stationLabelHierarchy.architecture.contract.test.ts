// tests/unit/ui/overview/IsometricCanvas.stationLabelHierarchy.architecture.contract.test.ts
//
// OVERVIEW-LIVE-MAP-01 Slice D.1 — REQUIRED architecture/static contract.
//
// Proves:
//  12  the shared renderer contains no station-id-specific business rules
//      for blocked/pool/staged/shipped — identity-visibility is carried by
//      the presentation primitive (showIdentityLabel), never inferred from
//      station.id
//  13  the semantic identity-visibility decision (which station ids are
//      redundant with their badge) lives in Overview-owned code
//
// Plain source-text scan, matching this repo's existing
// *-architecture.contract.test.ts convention.

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');
const SHARED_RENDERER_FILE = 'modules/shared/src/ui/IsometricCanvas.tsx';
const SHARED_TYPES_FILE = 'modules/shared/src/ui/IsometricCanvas.types.ts';
const OVERVIEW_PRESENTATION_FILE = 'apps/frontend/src/pages/overview/overviewOperationalState.ts';

function readSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`[EXPECTED] ${relPath} must exist.`);
  }
  return fs.readFileSync(abs, 'utf8');
}

describe('shared IsometricCanvas — Slice D.1 station-identity architecture boundary', () => {
  it('12: the renderer never branches on a station id string to decide identity visibility', () => {
    const source = readSource(SHARED_RENDERER_FILE);
    // No conditional keyed on the literal station ids anywhere in the file —
    // the only mentions of these words are as merchant-copy comments/labels
    // pre-dating this slice (e.g. "OV-40" comments), never as an
    // `id === 'blocked'`-style comparison the renderer branches on.
    expect(source).not.toMatch(/station\.id\s*===\s*['"](blocked|pool|staged|shipped)['"]/);
    expect(source).not.toMatch(/\.id\s*===\s*['"](blocked|pool|staged|shipped)['"][\s\S]{0,80}showIdentityLabel/);
  });

  it('12b: the renderer reads identity visibility only from the presentation primitive', () => {
    const source = readSource(SHARED_RENDERER_FILE);
    expect(source).toMatch(/stationPresentation\?\.showIdentityLabel/);
  });

  it('the shared OperationalMapPresentation type carries showIdentityLabel as a plain boolean, no business enum', () => {
    const typesSource = readSource(SHARED_TYPES_FILE);
    const presentationBlockMatch = typesSource.match(
      /export interface OperationalMapPresentation \{[\s\S]*?\n\}/
    );
    expect(presentationBlockMatch).not.toBeNull();
    const block = presentationBlockMatch![0];
    expect(block).toMatch(/showIdentityLabel\?:\s*boolean/);
  });

  it('13: Overview-owned code contains the semantic identity-visibility decision (per station id)', () => {
    const overviewSource = readSource(OVERVIEW_PRESENTATION_FILE);
    expect(overviewSource).toMatch(/STATION_SHOW_IDENTITY/);
    expect(overviewSource).toMatch(/blocked:\s*false/);
    expect(overviewSource).toMatch(/pool:\s*true/);
    expect(overviewSource).toMatch(/staged:\s*false/);
    expect(overviewSource).toMatch(/shipped:\s*false/);
  });

  it('the renderer does not import Overview-owned presentation/business logic (reaffirms Slice C/D boundary)', () => {
    const source = readSource(SHARED_RENDERER_FILE);
    const importSpecifierPattern =
      /(?:from\s+|require\()\s*['"][^'"]*(overviewOperationalState|pages\/(overview\/|ft2-pages\/OverviewFT2Page))/;
    expect(source).not.toMatch(importSpecifierPattern);
  });
});
