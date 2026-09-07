import fs from 'fs';
import path from 'path';

const suppliersPortalSrc = fs.readFileSync(
  path.join(
    process.cwd(),
    'apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx',
  ),
  'utf8',
);

const upgradePromptSrc = fs.readFileSync(
  path.join(
    process.cwd(),
    'apps/frontend/src/components/UpgradePrompt.tsx',
  ),
  'utf8',
);

function sourcingGateRegion(): string {
  const capability = 'capabilityId="purchasing.sourcing"';
  const capabilityIndex = suppliersPortalSrc.indexOf(capability);

  if (capabilityIndex < 0) return '';

  const start = suppliersPortalSrc.lastIndexOf('<CommercialGate', capabilityIndex);
  const end = suppliersPortalSrc.indexOf('</CommercialGate>', capabilityIndex);

  if (start < 0 || end < 0) return '';

  return suppliersPortalSrc.slice(start, end + '</CommercialGate>'.length);
}

function lockedGateRegion(): string {
  const start = upgradePromptSrc.indexOf('function LockedGate');
  const end = upgradePromptSrc.indexOf('function UpgradeModal', start);

  if (start < 0 || end < 0) return '';

  return upgradePromptSrc.slice(start, end);
}

describe('PUR-COMM-UX-01 — direct Sourcing route upgrade UX', () => {
  it('GREEN CONTROL: SourcingRoute remains physically inside the purchasing.sourcing CommercialGate', () => {
    const region = sourcingGateRegion();

    expect(region).toContain('<CommercialGate');
    expect(region).toContain('capabilityId="purchasing.sourcing"');
    expect(region).toContain('<SourcingRoute');
  });

  it('EXPECTED RED: the direct Sourcing gate declares contextual feature copy instead of the generic intelligence-suite fallback', () => {
    const region = sourcingGateRegion();

    expect(region).toContain('featureName="Sourcing"');
    expect(region).toContain(
      'Turn inventory demand into supplier recommendations, purchasing priorities, and smarter reorder decisions.',
    );
  });

  it('EXPECTED RED: locked commercial routes use the FT2 surface token rather than the generic theme background', () => {
    const region = lockedGateRegion();

    expect(region).toMatch(
      /(?:background|bgcolor):\s*['"]var\(--surface\)['"]/,
    );

    expect(region).not.toContain(
      'theme.palette.background.default',
    );
  });
});
