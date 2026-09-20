import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../../..');

function readSource(relPath: string): string {
  const abs = path.join(REPO, relPath);
  if (!fs.existsSync(abs)) throw new Error(`[EXPECTED] ${relPath} must exist.`);
  return fs.readFileSync(abs, 'utf8');
}

describe('Overview live-map inspection architecture boundary', () => {
  it('/problem-center and /orders/flow route ownership stays in Overview', () => {
    const overviewSource = readSource('apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx');
    const rendererSource = readSource('modules/shared/src/ui/IsometricCanvas.tsx');
    const rendererTypesSource = readSource('modules/shared/src/ui/IsometricCanvas.types.ts');

    expect(overviewSource).toContain("to: '/problem-center'");
    expect(overviewSource).toContain("to: '/orders/flow'");
    expect(rendererSource).not.toContain('/problem-center');
    expect(rendererSource).not.toContain('/orders/flow');
    expect(rendererTypesSource).not.toContain('/problem-center');
    expect(rendererTypesSource).not.toContain('/orders/flow');
  });

  it('IsometricCanvas imports no Problem Center or Orders business modules', () => {
    const rendererSource = readSource('modules/shared/src/ui/IsometricCanvas.tsx');
    const forbiddenBusinessImport =
      /(?:from\s+|require\()\s*['"][^'"]*(problem-center|orders\/|OrderFlow|useOrderPool|useProblemCenter)/i;
    expect(rendererSource).not.toMatch(forbiddenBusinessImport);
  });

  it('inspection presentation derives from existing Overview pulse and presentation records', () => {
    const overviewSource = readSource('apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx');
    expect(overviewSource).toMatch(/const selectedLocationPulse =[\s\S]*locationPulseByCode\[selectedLocationCode\]/);
    expect(overviewSource).toMatch(/const selectedStationPulse =[\s\S]*stationPulseById\[selectedStationId\]/);
    expect(overviewSource).toMatch(/deriveLocationOperationalPresentation\(/);
    expect(overviewSource).toMatch(/deriveStationOperationalPresentation\(/);
    expect(overviewSource).not.toMatch(/selectedInspection[\s\S]{0,160}deriveLocationOperationalState\(/);
    expect(overviewSource).not.toMatch(/selectedInspection[\s\S]{0,160}deriveStationOperationalState\(/);
  });

  it('map selection does not switch Overview into a split inspection layout', () => {
    const overviewSource = readSource('apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx');
    expect(overviewSource).not.toContain('gridTemplateColumns: selectedInspection');
    expect(overviewSource).not.toContain('overview-map-inspection');
    expect(overviewSource).toContain('pinnedAction=');
  });

  it('only Overview decides which pinned CTA exists', () => {
    const overviewSource = readSource('apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx');
    const rendererSource = readSource('modules/shared/src/ui/IsometricCanvas.tsx');
    expect(overviewSource).toContain('selectedInspectionRoute');
    expect(rendererSource).toContain('pinnedAction');
    expect(rendererSource).not.toContain('Open Problem Center');
    expect(rendererSource).not.toContain('Open order flow');
  });
});
