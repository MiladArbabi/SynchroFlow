import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-GA-01 Google Analytics wiring', () => {
  test('all GA4 surfaces use the same measurement id and consent cookie', () => {
    for (const file of [
      'apps/frontend/src/analytics/googleAnalytics.ts',
      'apps/marketing/components/GoogleAnalyticsProvider.tsx',
      'packages/landing-page/index.html',
    ]) {
      const text = source(file);

      expect(text).toContain('G-1H3XLN9MN2');
      expect(text).toContain('lasyncro_analytics_consent');
    }
  });

  test('app GA4 loads only after explicit consent', () => {
    const ga = source('apps/frontend/src/analytics/googleAnalytics.ts');

    expect(ga).toContain("getAnalyticsConsent() !== 'granted'");
    expect(ga).toContain("document.createElement('script')");
    expect(ga).toContain('googletagmanager.com/gtag/js');
    expect(ga).toContain('send_page_view: false');
  });

  test('app explicitly tracks SPA route pageviews', () => {
    const tracker = source(
      'apps/frontend/src/analytics/GoogleAnalyticsPageView.tsx'
    );
    const main = source('apps/frontend/src/main.tsx');
    const ga = source('apps/frontend/src/analytics/googleAnalytics.ts');

    expect(tracker).toContain('useLocation()');
    expect(tracker).toContain('location.pathname');
    expect(tracker).toContain('location.search');
    expect(tracker).toContain('trackGoogleAnalyticsPageView()');
    expect(ga).toContain("'event', 'page_view'");
    expect(main).toContain('<GoogleAnalyticsPageView />');
  });

  test('marketing GA4 is production-host and consent gated', () => {
    const provider = source(
      'apps/marketing/components/GoogleAnalyticsProvider.tsx'
    );
    const layout = source('apps/marketing/app/layout.tsx');

    expect(provider).toContain("'www.lasyncro.com'");
    expect(provider).toContain("'lasyncro.com'");
    expect(provider).toContain("process.env.NODE_ENV !== 'production'");
    expect(provider).toContain("getConsent() !== 'granted'");
    expect(provider).toContain('googletagmanager.com/gtag/js');
    expect(provider).toContain("'event', 'page_view'");
    expect(provider).toContain('send_page_view: false');

    expect(layout).toContain('<GoogleAnalyticsProvider>');
    expect(layout).toContain('</GoogleAnalyticsProvider>');
  });

  test('static homepage GA4 is production-host and consent gated', () => {
    const html = source('packages/landing-page/index.html');

    expect(html).toContain("window.location.hostname === 'www.lasyncro.com'");
    expect(html).toContain("window.location.hostname === 'lasyncro.com'");
    expect(html).toContain("getConsent() !== 'granted'");
    expect(html).toContain('googletagmanager.com/gtag/js');
    expect(html).toContain("window.gtag('event', 'page_view'");
    expect(html).toContain('send_page_view: false');
  });

  test('GA4 is never loaded through an unconditional external script tag', () => {
    for (const file of [
      'apps/frontend/index.html',
      'packages/landing-page/index.html',
    ]) {
      const text = source(file);

      expect(text).not.toContain(
        '<script async src="https://www.googletagmanager.com/gtag/js'
      );
    }
  });
});
