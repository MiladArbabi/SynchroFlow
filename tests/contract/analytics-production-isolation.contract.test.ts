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

  test('GA4 is host-gated before the Google script is created', () => {
    const html = source('apps/frontend/index.html');

    expect(html).toContain(
      "window.location.hostname === 'app.lasyncro.com'"
    );
    expect(html).toContain(
      "document.createElement('script')"
    );
    expect(html).not.toContain(
      '<script async src="https://www.googletagmanager.com/gtag/js'
    );
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
