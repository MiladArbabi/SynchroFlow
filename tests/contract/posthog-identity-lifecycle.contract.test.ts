import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 PostHog identity lifecycle', () => {
  test('analytics adapter exposes a production-gated identity reset', () => {
    const adapter = source('apps/frontend/src/analytics/adapter.ts');

    expect(adapter).toContain('export function resetAnalyticsIdentity');
    expect(adapter).toContain('isProductionAnalyticsRuntime()');
    expect(adapter).toContain('posthog.reset()');
  });

  test('logout resets PostHog identity before the session is discarded', () => {
    const auth = source('apps/frontend/src/contexts/AuthContext.tsx');

    expect(auth).toContain('resetAnalyticsIdentity');

    const logoutBlock = auth.match(
      /const logout = useCallback\([\s\S]*?\}, \[\]\);/
    )?.[0];

    expect(logoutBlock).toBeDefined();
    expect(logoutBlock).toContain('resetAnalyticsIdentity()');
  });
});
