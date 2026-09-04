import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '../..');
const FRONTEND = path.join(ROOT, 'apps/frontend');
const CONFIG_FILE = path.join(FRONTEND, 'vite.config.ts');
const MARKER = '[FRONTEND_PRODUCTION_BUILD_ENV_REQUIRED]';

// Resolve the Vite CLI the way the frontend workspace would (handles hoisted or
// workspace-local installs) instead of hard-coding a node_modules path.
const VITE_BIN = path.join(
  path.dirname(require.resolve('vite/package.json', { paths: [FRONTEND] })),
  'bin/vite.js'
);

/** Env clone with NODE_ENV forced to a value, or removed when `value` is null. */
function envWith(value: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (value === null) delete env.NODE_ENV;
  else env.NODE_ENV = value;
  return env;
}

/**
 * Drive the SAME config-resolution call that `vite build` performs
 * (`resolveConfig(inlineConfig, 'build', 'production', 'production')`) in a
 * clean child process, so the fail-closed invariant in vite.config.ts is
 * exercised against the real production config without running a full bundle.
 */
function resolveProductionBuildConfig(nodeEnv: string | null) {
  const script = `
    const path = require('node:path');
    const configFile = process.argv[1];
    const root = process.argv[2];
    import('vite')
      .then(({ resolveConfig }) =>
        resolveConfig({ configFile, root }, 'build', 'production', 'production')
      )
      .then(() => { console.log('RESOLVE_OK'); })
      .catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
  `;
  const result = spawnSync(process.execPath, ['-e', script, CONFIG_FILE, FRONTEND], {
    cwd: FRONTEND,
    env: envWith(nodeEnv),
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

describe('frontend production build environment contract', () => {
  it('pins the Docker frontend Vite build to NODE_ENV=production', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

    expect(dockerfile).toMatch(
      /RUN [^\n]*NODE_ENV=production[^\n]*npm --workspace \.\/apps\/frontend exec -- vite build/
    );
  });

  it('fails closed when the real `vite build` inherits development NODE_ENV', () => {
    const result = spawnSync(
      process.execPath,
      [VITE_BIN, 'build', '--config', './vite.config.ts'],
      { cwd: FRONTEND, env: envWith('development'), encoding: 'utf8' }
    );

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(MARKER);
  });

  it('does NOT trip the invariant for an ordinary production build with NODE_ENV unset', () => {
    // Vite sets NODE_ENV=production (its `build` defaultNodeEnv) before loading
    // the config, so a plain `npm run build` / `vite build` outside Docker must
    // still succeed. Guards against the invariant becoming Docker-only.
    const { status, output } = resolveProductionBuildConfig(null);

    expect(output).not.toContain(MARKER);
    expect(output).toContain('RESOLVE_OK');
    expect(status).toBe(0);
  });

  it('resolves cleanly for an explicit NODE_ENV=production build', () => {
    const { status, output } = resolveProductionBuildConfig('production');

    expect(output).not.toContain(MARKER);
    expect(output).toContain('RESOLVE_OK');
    expect(status).toBe(0);
  });
});
