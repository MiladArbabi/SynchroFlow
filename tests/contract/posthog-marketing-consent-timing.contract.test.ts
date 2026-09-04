import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 marketing PostHog consent timing', () => {
  test('marketing exposes one consent-aware custom-event boundary', () => {
    const provider = source(
      'apps/marketing/components/PostHogProvider.tsx'
    );

    expect(provider).toContain('export function captureMarketingEvent');
    expect(provider).toContain("getConsent() !== 'granted'");
    expect(provider).toContain('posthogInitialized');
    expect(provider).toMatch(
      /captureMarketingEvent[\s\S]*?posthog\.capture\(/
    );
  });

  test('marketing components do not call usePostHog or capture directly', () => {
    const files = [
      'apps/marketing/components/about/AboutCTAs.tsx',
      'apps/marketing/components/blog/BlogArticleTracker.tsx',
      'apps/marketing/components/compare/CompareArticleTracker.tsx',
      'apps/marketing/components/compare/CompareCTA.tsx',
      'apps/marketing/components/article/ArticleCTA.tsx',
      'apps/marketing/components/pricing/PricingPlanCTA.tsx',
    ];

    for (const file of files) {
      const text = source(file);

      expect(text).not.toContain('usePostHog');
      expect(text).not.toMatch(/\bph\?\.capture\(/);
      expect(text).toContain('captureMarketingEvent');
    }
  });
});
