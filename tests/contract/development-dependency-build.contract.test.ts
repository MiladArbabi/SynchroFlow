import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const scripts = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).scripts;

describe('BUILD-PRUNE — development dependency preparation', () => {
  it('routes development startup through the dedicated build', () => {
    expect(scripts['dev:prepare']).toBe('npm run build:deps:dev');
    expect(scripts.dev).toContain('npm run dev:prepare');
  });

  it('reuses the production-certified dependency sequence', () => {
    expect(scripts['build:deps:dev'])
      .toBe('npm run build:deps:production');
  });

  it('preserves complete dependency preparation for tests', () => {
    expect(scripts['test:prepare']).toBe('npm run build:deps');
    expect(scripts['build:deps'].split(' && ')).toHaveLength(20);
    expect(scripts['build:deps:production'].split(' && '))
      .toHaveLength(11);
  });
});
