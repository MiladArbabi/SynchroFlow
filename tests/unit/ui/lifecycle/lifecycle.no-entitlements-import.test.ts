//tests/unit/ui/lifecycle/lifecycle.no-entitlements-import.test.ts

import fs from 'fs';
import path from 'path';

const LIFECYCLE_DIR = path.resolve(
  __dirname,
  '../../../../apps/frontend/src/lifecycle'
);

describe('Lifecycle layer purity (RED)', () => {
  it('does not import EntitlementsContext anywhere in lifecycle', () => {
    const files = fs
      .readdirSync(LIFECYCLE_DIR)
      .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

    const offenders = files.filter(file => {
      const content = fs.readFileSync(
        path.join(LIFECYCLE_DIR, file),
        'utf8'
      );
      return (
        content.includes('useEntitlements') ||
        content.includes('EntitlementsContext')
      );
    });

    expect(offenders).toEqual([]);
  });
});