import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 PostHog PII boundary', () => {
  test('checklist waitlist analytics does not send raw email', () => {
    const html = source('packages/landing-page/checklist/index.html');

    expect(html).toContain("posthog.capture('waitlist_signup'");
    expect(html).not.toMatch(
      /posthog\.capture\('waitlist_signup'[\s\S]{0,250}\bemail\s*:/
    );
  });
});
