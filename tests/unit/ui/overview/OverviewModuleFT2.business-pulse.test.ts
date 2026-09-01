// tests/unit/ui/overview/OverviewModuleFT2.business-pulse.test.ts
//
// OV-DATA-03 — RED-first Business Pulse row contract.
//
// buildBusinessPulseRows is intentionally file-local today and full
// OverviewModuleFT2 rendering still risks unrelated shared-ui ESM debt, so this
// uses the smallest static architecture seam until a production helper seam is
// explicitly authorized.

import fs from 'fs';
import path from 'path';

const sourcePath = path.join(
  process.cwd(),
  'modules/overview/src/ui/pages/OverviewModuleFT2.tsx'
);

function businessPulseRowsSource(): string {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('function buildBusinessPulseRows');
  const end = source.indexOf('function MergedPulseCard', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('OverviewModuleFT2 Business Pulse — OV-DATA-03 row contract', () => {
  it('OV-REV-07 removes Collected today without dropping the remaining pulse rows', () => {
    const rowsSource = businessPulseRowsSource();

    expect(rowsSource).not.toContain("label: 'Collected today'");
    expect(rowsSource).not.toContain("id: 'collected-today'");

    expect(rowsSource).toContain("label: 'Blocked'");
    expect(rowsSource).toContain("label: 'Revenue today'");
    expect(rowsSource).toContain("label: 'At risk'");
    expect(rowsSource).toContain('pulse.blockedRevenue');
    expect(rowsSource).toContain('pulse.atRiskRevenue');
  });
});
