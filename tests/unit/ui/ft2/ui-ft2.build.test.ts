import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('ui-ft2 buildability gate', () => {
  it('emits dist/ via tsc', () => {
    execSync('npx tsc -p modules/ui-ft2/tsconfig.json', {
      stdio: 'inherit',
    });

    const distPath = path.resolve('modules/ui-ft2/dist');
    expect(fs.existsSync(distPath)).toBe(true);
  });
});