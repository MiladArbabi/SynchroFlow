import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 shared analytics consent UX', () => {
  test('marketing consent copy describes analytics generically, not GA alone', () => {
    const provider = source(
      'apps/marketing/components/GoogleAnalyticsProvider.tsx'
    );

    expect(provider).toContain('Allow analytics');
    expect(provider).toContain('Decline analytics');
    expect(provider).toContain('analytics tools');

    expect(provider).not.toContain('Allow Google Analytics');
    expect(provider).not.toContain('Decline Google Analytics');
  });

  test('static homepage consent copy describes the shared analytics choice', () => {
    const page = source('packages/landing-page/index.html');

    expect(page).toContain("aria-label', 'Analytics consent'");
    expect(page).toContain("'Allow analytics'");
    expect(page).toContain("'Decline analytics'");
    expect(page).toContain('analytics tools');

    expect(page).not.toContain("'Allow Google Analytics'");
    expect(page).not.toContain("'Decline Google Analytics'");
  });

  test('checklist provides the same first-visit analytics consent choice', () => {
    const page = source('packages/landing-page/checklist/index.html');

    expect(page).toContain('const setConsent = (value) =>');
    expect(page).toContain("aria-label', 'Analytics consent'");
    expect(page).toContain("'Allow analytics'");
    expect(page).toContain("'Decline analytics'");
    expect(page).toContain(
      "new CustomEvent('lasyncro:analytics-consent'"
    );
  });
});
