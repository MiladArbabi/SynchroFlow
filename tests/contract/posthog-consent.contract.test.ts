import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 PostHog consent', () => {
  test('frontend PostHog uses the shared analytics consent state', () => {
    const main = source('apps/frontend/src/main.tsx');

    expect(main).toContain('getAnalyticsConsent');
    expect(main).toContain("getAnalyticsConsent() !== 'granted'");
    expect(main).toContain("'lasyncro:analytics-consent'");
  });

  test('analytics consent copy covers analytics rather than Google Analytics only', () => {
    const banner = source(
      'apps/frontend/src/analytics/AnalyticsConsentBanner.tsx'
    );

    expect(banner).toContain('LaSyncro uses analytics');
    expect(banner).not.toContain('Allow Google Analytics');
    expect(banner).not.toContain('Decline Google Analytics');
  });
});

describe('AN-PH-01 public-surface PostHog consent', () => {
  test('Next marketing PostHog requires shared analytics consent', () => {
    const provider = source('apps/marketing/components/PostHogProvider.tsx');

    expect(provider).toContain('lasyncro_analytics_consent');
    expect(provider).toContain("getConsent() !== 'granted'");
    expect(provider).toContain("'lasyncro:analytics-consent'");
  });

  test('static homepage PostHog requires shared analytics consent', () => {
    const html = source('packages/landing-page/index.html');

    const posthogBlock = html.match(
      /<!-- PostHog -->[\s\S]*?<\/script>/
    )?.[0];

    expect(posthogBlock).toBeDefined();
    expect(posthogBlock).toContain('lasyncro_analytics_consent');
    expect(posthogBlock).toContain("getAnalyticsConsent() !== 'granted'");
  });

  test('checklist PostHog requires consent and preserves cross-subdomain identity options', () => {
    const html = source('packages/landing-page/checklist/index.html');

    expect(html).toContain('lasyncro_analytics_consent');
    expect(html).toContain("getAnalyticsConsent() !== 'granted'");
    expect(html).toContain("cookie_domain:'.lasyncro.com'");
    expect(html).toContain('cross_subdomain_cookie:true');
    expect(html).toContain("persistence:'localStorage+cookie'");
  });
});
