// apps/backend/src/bootstrap/tsconfig-paths-register.ts
// Lightweight helper to register tsconfig path aliases at runtime.
// Usage: require('./bootstrap/tsconfig-paths-register') from Node startup
import path from 'path';

try {
  // Use require to avoid types/runtime mismatches when compiled.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsconfigPaths = require('tsconfig-paths');

  // Resolve project root relative to this file.
  const projectRoot = path.resolve(__dirname, '../../..');

  // Load root tsconfig.json
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsconfig = require(path.join(projectRoot, 'tsconfig.json'));

  const baseUrl = projectRoot;
  const paths = (tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.paths) ? tsconfig.compilerOptions.paths : {};

  tsconfigPaths.register({ baseUrl, paths });
  // eslint-disable-next-line no-console
  console.log('[bootstrap] tsconfig-paths registered (backend)');
} catch (err: any) {
  // Non-fatal: if the package is not installed or registration fails, log and continue.
  // eslint-disable-next-line no-console
  console.warn('[bootstrap] tsconfig-paths register failed:', err && err.message ? err.message : err);
}

export {}; // keep module scope explicit for TS
