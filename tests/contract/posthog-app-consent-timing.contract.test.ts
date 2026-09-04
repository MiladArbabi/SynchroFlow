import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 app PostHog consent timing', () => {
  test('PostHog initialization exposes an explicit ready state only after init', () => {
    const main = source('apps/frontend/src/main.tsx');

    expect(main).toContain('__LASYNCRO_POSTHOG_READY__');
    expect(main).toContain("'lasyncro:posthog-ready'");
    expect(main).toMatch(
      /posthog\.init\([\s\S]*?__LASYNCRO_POSTHOG_READY__\s*=\s*true/
    );
  });

  test('SPA pageviews wait for PostHog readiness before capture', () => {
    const tracker = source(
      'apps/frontend/src/analytics/PostHogPageView.tsx'
    );

    expect(tracker).toContain('__LASYNCRO_POSTHOG_READY__');
    expect(tracker).toContain("'lasyncro:posthog-ready'");
    expect(tracker).toMatch(
      /if\s*\(![a-zA-Z]+Ready\)\s*return/
    );
  });

  test('adapter events cannot capture before analytics consent and PostHog readiness', () => {
    const adapter = source('apps/frontend/src/analytics/adapter.ts');

    expect(adapter).toContain('getAnalyticsConsent');
    expect(adapter).toContain('__LASYNCRO_POSTHOG_READY__');
    expect(adapter).toContain("getAnalyticsConsent() !== 'granted'");
  });

  test('pre-consent authenticated identity is retained for replay after PostHog becomes ready', () => {
    const adapter = source('apps/frontend/src/analytics/adapter.ts');

    expect(adapter).toContain('pendingIdentity');
    expect(adapter).toContain('pendingShopId');
    expect(adapter).toContain("'lasyncro:posthog-ready'");
  });
});
