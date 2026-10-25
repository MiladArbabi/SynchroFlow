import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');

const scripts = JSON.parse(
  fs.readFileSync(
    path.join(root, 'apps/backend/package.json'),
    'utf8'
  )
).scripts;

describe('GH-1131-A — backend development compilation', () => {
  it('compiles only the application and fails on errors', () => {
    expect(scripts['build:dev'])
      .toBe('tsc --project tsconfig.json');
  });

  it('preserves the deterministic full backend build', () => {
    expect(scripts.build).toBe(
      'tsc --project tsconfig.json --incremental false' +
      ' && tsc --project tsconfig.migrations.json --incremental false'
    );
  });

  it('preserves independent migration compilation', () => {
    expect(scripts.migrate)
      .toContain('tsc --project tsconfig.migrations.json');

    expect(scripts['migrate:rollback'])
      .toContain('tsc --project tsconfig.migrations.json');
  });

  it('preserves API and worker startup supervision', () => {
    expect(scripts.dev).toContain(
      'npm run build:dev && node ./scripts/node-start.js'
    );

    expect(scripts['dev:worker']).toContain(
      'npm run build:dev && node dist/worker-entry.js'
    );
  });
});
