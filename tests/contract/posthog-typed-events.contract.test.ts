import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 typed frontend analytics path', () => {
  test('product UI does not import sendEvent directly from the analytics adapter', () => {
    const files = [
      'apps/frontend/src/components/UpgradePrompt.tsx',
      'apps/frontend/src/pages/ft2-pages/OverviewFT2Page.tsx',
    ];

    for (const file of files) {
      const text = source(file);

      expect(text).not.toMatch(
        /import\s*\{\s*sendEvent\s*\}\s*from\s*['"][^'"]*analytics\/adapter['"]/
      );
      expect(text).toContain('useUiEvents');
    }
  });

  test('all upgrade prompt events used by product UI are declared in UiEventName', () => {
    const events = source('apps/frontend/src/analytics/useUiEvents.ts');

    expect(events).toContain("| 'upgrade_prompt.shown'");
    expect(events).toContain("| 'upgrade_prompt.dismissed'");
    expect(events).toContain("| 'upgrade_prompt.clicked'");
    expect(events).toContain("| 'upgrade_prompt.see_plans'");
  });
});
