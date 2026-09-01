// tests/unit/ui/overview/OverviewModuleFT2.refresh-visibility.test.ts
//
// OV-UX-18B — RED-first refresh icon visibility contract.
//
// Full OverviewModuleFT2 rendering currently risks unrelated shared-ui Jest
// import-resolution debt. This locks the smallest architecture seam until the
// component exposes a pure rotation/style helper or the render harness is
// safe to import the full module.

import fs from 'fs';
import path from 'path';

const sourcePath = path.join(
  process.cwd(),
  'modules/overview/src/ui/pages/OverviewModuleFT2.tsx'
);

function overviewSource(): string {
  return fs.readFileSync(sourcePath, 'utf8');
}

function refreshStyleSource(): string {
  const source = overviewSource();
  const start = source.indexOf('const refreshButtonSx');
  const end = source.indexOf('type SevKey', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('OverviewModuleFT2 refresh icon visibility — OV-UX-18B', () => {
  it('OV-REFRESH-VIS-01/02 uses accumulated 180-degree rotation per accepted click', () => {
    const source = overviewSource();
    const incrementsByHalfTurn =
      /set[A-Za-z0-9_]*Rotation[A-Za-z0-9_]*\(\s*\(?[A-Za-z0-9_]+\)?\s*=>\s*[A-Za-z0-9_]+\s*\+\s*180\s*\)/.test(source);
    const drivesVisibleTransform =
      /rotate\(\$\{[^}]+Rotation[^}]*\}deg\)/.test(source);

    expect(incrementsByHalfTurn).toBe(true);
    expect(drivesVisibleTransform).toBe(true);
  });

  it('OV-REFRESH-VIS-03/06 is click-driven and not a pending-state infinite spin', () => {
    const source = refreshStyleSource();

    expect(source).not.toContain('overviewRefreshSpin');
    expect(source).not.toContain('linear infinite');
    expect(source).toContain('prefers-reduced-motion');
  });
});
