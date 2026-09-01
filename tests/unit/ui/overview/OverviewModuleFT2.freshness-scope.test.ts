// tests/unit/ui/overview/OverviewModuleFT2.freshness-scope.test.ts
//
// OV-DATA-02B — RED-first Morning Brief freshness-scope contract.
//
// Overview is intentionally composed from independently evaluated data sources.
// morningBrief.generatedAt therefore belongs only to the Morning Brief /
// Needs a Decision surface and must not visually imply Business Pulse freshness.
//
// Full OverviewModuleFT2 rendering still carries unrelated shared-ui Jest
// import-resolution debt, so this uses the established static architecture seam.

import fs from 'fs';
import path from 'path';

const sourcePath = path.join(
  process.cwd(),
  'modules/overview/src/ui/pages/OverviewModuleFT2.tsx'
);

function overviewSource(): string {
  return fs.readFileSync(sourcePath, 'utf8');
}

function mergedPulseCardSource(): string {
  const source = overviewSource();
  const start = source.indexOf('function MergedPulseCard');
  const end = source.indexOf('// ─── MAIN COMPONENT', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function triageDecisionCardSource(): string {
  const source = overviewSource();
  const start = source.indexOf('{/* LEFT: Needs a decision */}');
  const end = source.indexOf('{pulse && (', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('OverviewModuleFT2 freshness scope — OV-DATA-02B', () => {
  it('OV-FRESH-01/02/03 scopes map-layout brief freshness and refresh controls before Business Pulse', () => {
    const merged = mergedPulseCardSource();
    const pulseStart = merged.indexOf('{/* ── BUSINESS PULSE');

    expect(pulseStart).toBeGreaterThanOrEqual(0);

    const morningBriefScope = merged.slice(0, pulseStart);
    const businessPulseAndAfter = merged.slice(pulseStart);

    // The Morning Brief section owns its own freshness and refresh affordance.
    expect(morningBriefScope).toContain('generatedTime');
    expect(morningBriefScope).toContain('Brief updated');
    expect(morningBriefScope).toContain('aria-label="Refresh morning brief"');

    // Business Pulse must not visually inherit Morning Brief freshness.
    expect(businessPulseAndAfter).not.toContain('generatedTime');
    expect(businessPulseAndAfter).not.toContain(
      'aria-label="Refresh morning brief"'
    );
  });

  it('OV-FRESH-04 keeps triage freshness inside Needs a Decision and labels it as brief freshness', () => {
    const decisionCard = triageDecisionCardSource();

    expect(decisionCard).toContain('generatedTime');
    expect(decisionCard).toContain('Brief updated');
    expect(decisionCard).toContain('aria-label="Refresh morning brief"');
  });
});
