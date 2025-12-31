import path from 'path';

try {
  // Runtime-only alias registration for compiled JS
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsconfigPaths = require('tsconfig-paths');

  /**
   * At runtime this file lives at:
   *   dist/apps/backend/src/bootstrap/tsconfig-paths-register.js
   *
   * So the compiled backend root is:
   *   dist/apps/backend/src
   */
  const distRoot = path.resolve(__dirname, '..'); // dist/apps/backend/src
  const repoRoot = path.resolve(__dirname, '../../../../../../../');

  tsconfigPaths.register({
    baseUrl: distRoot,
    paths: {
      'api-src/*': [path.join(distRoot, '*')],
      'api-db': [path.join(distRoot, 'db.js')],
      'api-types': [path.join(distRoot, 'types.js')],
      'modules-specter/*': [
        path.join(repoRoot, 'modules/specter/dist/*'),
      ],
    },
  });

  // eslint-disable-next-line no-console
  console.log('[bootstrap] runtime tsconfig-paths registered (dist)');
} catch (err: any) {
  // Non-fatal, but should never fail in a correct build
  // eslint-disable-next-line no-console
  console.warn(
    '[bootstrap] runtime tsconfig-paths register failed:',
    err?.message ?? err
  );
}

export {};