import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 PostHog PII boundary', () => {
  test('checklist waitlist analytics does not send raw email', () => {
    const html = source('packages/landing-page/checklist/index.html');

    expect(html).toContain("posthog.capture('waitlist_submission_accepted'");
    expect(html).not.toMatch(
      /posthog\.capture\('waitlist_submission_accepted'[\s\S]{0,250}\bemail\s*:/
    );
  });

  // MARKETING-P0-IMPLEMENT-002: the newsletter form is protected statically
  // (LaunchNotifyForm is covered behaviourally in
  // marketing-next-consent-behavior.contract.test.ts).
  test('blog newsletter analytics fires only after API success and without email', () => {
    const blog = source('apps/marketing/app/blog/BlogIndex.tsx');

    const failure = blog.indexOf('if (!res.ok) {');
    const capture = blog.indexOf("captureMarketingEvent('waitlist_submission_accepted'");
    expect(failure).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(failure);

    const props = blog.match(
      /captureMarketingEvent\('waitlist_submission_accepted',\s*\{([\s\S]*?)\}\)/
    );
    expect(props).not.toBeNull();
    expect(props?.[1]).not.toMatch(/\bemail\b/i);
  });
});
