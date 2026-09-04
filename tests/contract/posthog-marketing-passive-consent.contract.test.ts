import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 marketing passive events after delayed consent', () => {
  test('marketing provider exposes analytics readiness to passive trackers', () => {
    const provider = source(
      'apps/marketing/components/PostHogProvider.tsx'
    );

    expect(provider).toContain(
      'export function useMarketingAnalyticsReady'
    );
    expect(provider).toContain("'lasyncro:analytics-consent'");
  });

  test('passive page/article trackers rerun when analytics becomes ready', () => {
    const blog = source(
      'apps/marketing/components/blog/BlogArticleTracker.tsx'
    );
    const compare = source(
      'apps/marketing/components/compare/CompareArticleTracker.tsx'
    );

    for (const text of [blog, compare]) {
      expect(text).toContain('useMarketingAnalyticsReady');
      expect(text).toContain('analyticsReady');
      expect(text).toContain('if (!analyticsReady) return');
    }

    const blogReadyDeps =
      blog.match(/\[[^\]]*analyticsReady[^\]]*\]/g) || [];
    const compareReadyDeps =
      compare.match(/\[[^\]]*analyticsReady[^\]]*\]/g) || [];

    expect(blogReadyDeps.length).toBeGreaterThanOrEqual(2);
    expect(compareReadyDeps.length).toBeGreaterThanOrEqual(1);
  });
});
