import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');

const readScripts = (file: string) =>
  JSON.parse(
    fs.readFileSync(path.join(root, file), 'utf8')
  ).scripts;

const rootScripts = readScripts('package.json');
const backendScripts = readScripts('apps/backend/package.json');

describe('GH-1131-B — shared backend development supervisor', () => {
  it('starts one shared backend supervisor', () => {
    expect(rootScripts.dev).toContain('"npm:dev-backend"');
    expect(rootScripts.dev).toContain('"npm:dev-ui"');
    expect(rootScripts.dev).toContain('npm run dev:prepare');
  });

  it('provides the dedicated supervisor entry point', () => {
    expect(rootScripts['dev-backend']).toBe(
      'node scripts/dev-backend-supervisor.mjs'
    );

    expect(
      fs.existsSync(
        path.join(root, 'scripts/dev-backend-supervisor.mjs')
      )
    ).toBe(true);
  });

  it('does not launch competing backend development builds', () => {
    expect(rootScripts.dev).not.toContain('"npm:dev-api"');
    expect(rootScripts.dev).not.toContain('"npm:dev-worker"');
  });

  it('preserves standalone development commands', () => {
    expect(backendScripts.dev).toContain(
      'npm run build:dev && node ./scripts/node-start.js'
    );

    expect(backendScripts['dev:worker']).toContain(
      'npm run build:dev && node dist/worker-entry.js'
    );
  });

  it('preserves application compilation and release builds', () => {
    expect(backendScripts['build:dev']).toBe(
      'tsc --project tsconfig.json'
    );

    expect(backendScripts.build).toBe(
      'tsc --project tsconfig.json --incremental false' +
      ' && tsc --project tsconfig.migrations.json --incremental false'
    );
  });
});
