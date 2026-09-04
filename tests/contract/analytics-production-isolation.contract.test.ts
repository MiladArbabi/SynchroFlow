import fs from 'fs';
import path from 'path';

import {
  shouldEnableFrontendAnalytics,
} from '../../apps/frontend/src/analytics/environment';

import {
  shouldEnableBackendAnalytics,
} from '../../apps/backend/src/utils/analyticsEnvironment';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-ENV-01 production analytics isolation', () => {
  test('frontend analytics only enables on production app runtime', () => {
    expect(
      shouldEnableFrontendAnalytics({
        hostname: 'app.lasyncro.com',
        mode: 'production',
      })
    ).toBe(true);

    expect(
      shouldEnableFrontendAnalytics({
        hostname: 'localhost',
        mode: 'development',
      })
    ).toBe(false);

    expect(
      shouldEnableFrontendAnalytics({
        hostname: 'app.lasyncro.com',
        mode: 'development',
      })
    ).toBe(false);

    expect(
      shouldEnableFrontendAnalytics({
        hostname: 'synchroflow-preview.vercel.app',
        mode: 'production',
      })
    ).toBe(false);
  });

  test('backend analytics requires production + explicit enable flag + API key', () => {
    expect(
      shouldEnableBackendAnalytics({
        NODE_ENV: 'production',
        ANALYTICS_PRODUCTION_ENABLED: 'true',
        POSTHOG_API_KEY: 'test-key',
      })
    ).toBe(true);

    expect(
      shouldEnableBackendAnalytics({
        NODE_ENV: 'development',
        ANALYTICS_PRODUCTION_ENABLED: 'true',
        POSTHOG_API_KEY: 'test-key',
      })
    ).toBe(false);

    expect(
      shouldEnableBackendAnalytics({
        NODE_ENV: 'production',
        ANALYTICS_PRODUCTION_ENABLED: undefined,
        POSTHOG_API_KEY: 'test-key',
      })
    ).toBe(false);

    expect(
      shouldEnableBackendAnalytics({
        NODE_ENV: 'production',
        ANALYTICS_PRODUCTION_ENABLED: 'true',
        POSTHOG_API_KEY: undefined,
      })
    ).toBe(false);
  });

  test('GA4 remains production-gated and is not loaded directly from app HTML', () => {
    const html = source('apps/frontend/index.html');
    const ga = source('apps/frontend/src/analytics/googleAnalytics.ts');

    expect(ga).toContain('shouldEnableFrontendAnalytics');
    expect(ga).toContain("getAnalyticsConsent() !== 'granted'");
    expect(ga).toContain("document.createElement('script')");
    expect(ga).toContain('https://www.googletagmanager.com/gtag/js?id=${GA4_ID}');

    expect(html).not.toContain('googletagmanager.com/gtag/js');
    expect(html).not.toContain('G-1H3XLN9MN2');
  });

  test('public marketing surfaces use an explicit production-host allowlist', () => {
    for (const file of [
      'apps/marketing/components/PostHogProvider.tsx',
      'packages/landing-page/index.html',
      'packages/landing-page/checklist/index.html',
    ]) {
      const text = source(file);
      expect(text).toContain("'www.lasyncro.com'");
      expect(text).toContain("'lasyncro.com'");
    }
  });

  test('checklist custom events cannot capture outside production hosts', () => {
    const html = source('packages/landing-page/checklist/index.html');

    expect(
      (
        html.match(
          /window\.__LASYNCRO_ANALYTICS_ENABLED__ && typeof posthog !== 'undefined'/g
        ) || []
      ).length
    ).toBeGreaterThanOrEqual(2);
  });
});
