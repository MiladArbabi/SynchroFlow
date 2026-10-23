import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string): string =>
  fs.readFileSync(path.join(ROOT, file), 'utf8');

const scripts = JSON.parse(read('package.json')).scripts;
const steps = (name: string): string[] =>
  scripts[name].split(' && ');

const excluded = [
  'ui-decision',
  'wms',
  'alerts',
  'cashflow',
  'demand',
  'finances',
  'fulfillment',
  'returns',
  'problem-center',
];

const required = [
  'npx tsc -p modules/shared/tsconfig.build.json',
  ...[
    'packages/epistemic',
    'packages/commercial-policy',
    'packages/backend-core',
    'modules/ui-ft2',
    'modules/customers',
    'modules/order-nexus',
    'modules/overview',
    'modules/products',
    'modules/suppliers-portal',
    'modules/floor-planning',
  ].map(p => `npm --workspace ./${p} run build`),
];

describe('BUILD-PRUNE — production dependency graph', () => {
  it('preserves the complete development/test build graph', () => {
    const full = steps('build:deps');

    expect(full).toHaveLength(20);

    for (const name of excluded) {
      expect(full).toContain(
        `npm --workspace ./modules/${name} run build`
      );
    }

    for (const command of required) {
      expect(full).toContain(command);
    }
  });

  it('builds only required production dependencies in order', () => {
    const production = steps('build:deps:production');

    expect(production).toEqual(required);
    expect(production).toHaveLength(11);
  });

  it('excludes exactly the nine approved build steps', () => {
    const full = steps('build:deps');
    const production = steps('build:deps:production');

    const omitted = full.filter(cmd => !production.includes(cmd));
    const approved = excluded.map(
      name => `npm --workspace ./modules/${name} run build`
    );

    expect(omitted.sort()).toEqual(approved.sort());
    expect(production).toEqual(
      full.filter(cmd => !approved.includes(cmd))
    );
  });

  it('preserves source resolution for active excluded modules', () => {
    const vite = read('apps/frontend/vite.config.ts');

    for (const name of [
      'alerts',
      'cashflow',
      'demand',
      'fulfillment',
      'returns',
      'wms',
      'problem-center',
    ]) {
      expect(vite).toContain(`'@lasyncro/${name}': path.resolve(`);
      expect(vite).toContain(
        `'../../modules/${name}/src/ui/index.ts'`
      );
      expect(
        fs.existsSync(
          path.join(ROOT, `modules/${name}/src/ui/index.ts`)
        )
      ).toBe(true);
    }
  });

  it('uses the optimized graph in Docker without changing runtime packaging', () => {
    const docker = read('Dockerfile');

    expect(docker).toContain('RUN npm run build:deps:production');
    expect(docker).not.toMatch(/^RUN npm run build:deps$/m);

    expect(docker).toContain('COPY --from=build /app /app');
    expect(docker).toContain(
      'CMD ["node", "apps/backend/dist/server.js"]'
    );
  });
});
