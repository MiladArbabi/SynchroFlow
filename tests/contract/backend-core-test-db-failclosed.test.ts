/**
 * TEST-DB-ISOLATION-11 Slice 1 — backend-core must FAIL CLOSED on a non-disposable
 * test database.
 *
 * Root cause (AUDIT): when `process.env.PGDATABASE` is absent at backend-core
 * module-eval time, `database.config` silently `dotenv`-falls back to root
 * `.env` → `PGDATABASE=synchroflow_db`, and every pool then targets the shared
 * dev DB. `npm run test:integration` runs went through `scripts/with-test-db.js`
 * (disposable `synchroflow_test_*` created/dropped) yet wrote to `synchroflow_db`.
 *
 * These cases run in spawned Node children because both config modules resolve
 * env at import time and are module-cached. They import the COMPILED
 * `@lasyncro/backend-core/*` (jest resolves the package dist), never src.
 *
 * `contract` project — DB-FREE: the children never issue a query; system-db
 * children destroy the lazy pool before exit.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Base child env: strip every DB-identity var, then set harmless PG* literals. */
function baseChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PGDATABASE;
  delete env.SYNCHROFLOW_DISPOSABLE_TEST_DB;
  delete env.DATABASE_URL;
  delete env.APP_DATABASE_URL;
  delete env.NODE_ENV;
  env.PGHOST = 'localhost';
  env.PGPORT = '5432';
  env.PGUSER = 'sf_app';
  env.PGPASSWORD = 'x';
  env.PGMIGRATION_USER = 'sf_user';
  env.PGMIGRATION_PASSWORD = 'x';
  return env;
}

interface Overrides {
  NODE_ENV?: string;
  PGDATABASE?: string | null; // null = leave unset
  SYNCHROFLOW_DISPOSABLE_TEST_DB?: string;
  __ARG__?: string;
  __HARNESS__?: string;
}

function runChild(script: string, overrides: Overrides, cwd: string = REPO_ROOT) {
  const env = baseChildEnv();
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined) {
      delete env[k];
    } else {
      env[k] = String(v);
    }
  }
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    env,
    encoding: 'utf8',
  });
}

/**
 * TEST-CI-DOTENV-161 — DB-D / DB-E exercise the legacy `.env`-fallback branch of
 * `database.config` (NODE_ENV set, no disposable harness, `PGDATABASE` NOT
 * inherited). That branch runs `dotenv.config({ path: <cwd>/.env })`, so the
 * assertion needs a `.env` at the child's cwd. Relying on the developer root
 * `.env` made these two cases fail wherever it is absent (CI checks it out
 * git-ignored). Instead, run the child from an isolated temp dir nested INSIDE
 * the repo — so workspace/package resolution still walks up to
 * `<repo>/node_modules` — carrying a throwaway `.env` with only the non-secret
 * `PGDATABASE` the fallback is expected to pick up. `PGDATABASE` is deliberately
 * NOT passed in the child env: that would bypass the dotenv fallback under test.
 * Caller must remove the returned dir in a finally block.
 */
function makeDotenvFallbackDir(): string {
  const dir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-dotenv-161-'));
  fs.writeFileSync(path.join(dir, '.env'), 'PGDATABASE=synchroflow_db\n', 'utf8');
  return dir;
}

// ── child scripts ────────────────────────────────────────────────────────────

const HELPER_SCRIPT = `
const raw = process.env.__ARG__;
const arg = raw === '__UNDEF__' ? undefined : raw;
const harness = process.env.__HARNESS__ === '1';
const { assertDisposableTestDatabase } =
  await import('@lasyncro/backend-core/config/test-database-safety.js');
try {
  assertDisposableTestDatabase(arg, { harness });
  console.log('RESULT=RETURN');
} catch (e) {
  console.log('RESULT=THROW');
  console.log('MSG=' + (e && e.message ? e.message : String(e)));
  process.exitCode = 1;
}
`;

const DBCONFIG_SCRIPT = `
const c = (await import('@lasyncro/backend-core/config/database.config.js')).default;
console.log('DB=' + (c && c.connection && c.connection.database));
`;

const SYSTEMDB_SCRIPT = `
const m = await import('@lasyncro/backend-core/system-db.js');
console.log('IMPORT_OK');
await m.systemDb.destroy();
`;

const REFUSAL = /REFUSING_BACKEND_CORE_NON_DISPOSABLE_TEST_DB/;

// ── 1. PURE HELPER MATRIX ────────────────────────────────────────────────────

describe('assertDisposableTestDatabase (pure helper)', () => {
  const CASES: Array<{
    n: number;
    arg: string | undefined;
    harness: boolean;
    expected: 'RETURN' | 'THROW';
    observed: string;
  }> = [
    { n: 1, arg: 'synchroflow_test_abc', harness: true, expected: 'RETURN', observed: 'synchroflow_test_abc' },
    { n: 2, arg: undefined, harness: true, expected: 'THROW', observed: '<unset>' },
    { n: 3, arg: '', harness: true, expected: 'THROW', observed: '<unset>' },
    { n: 4, arg: 'synchroflow_db', harness: true, expected: 'THROW', observed: 'synchroflow_db' },
    { n: 5, arg: 'synchroflow_db', harness: false, expected: 'THROW', observed: 'synchroflow_db' },
    { n: 6, arg: 'postgres', harness: false, expected: 'THROW', observed: 'postgres' },
    { n: 7, arg: 'synchroflow_test_abc', harness: false, expected: 'RETURN', observed: 'synchroflow_test_abc' },
    { n: 8, arg: undefined, harness: false, expected: 'RETURN', observed: '<unset>' },
    { n: 9, arg: '', harness: false, expected: 'RETURN', observed: '<unset>' },
  ];

  it.each(CASES)(
    'case $n: harness=$harness arg=$arg → $expected',
    ({ arg, harness, expected, observed }) => {
      const r = runChild(HELPER_SCRIPT, {
        __ARG__: arg === undefined ? '__UNDEF__' : arg,
        __HARNESS__: harness ? '1' : '0',
      });
      const out = `${r.stdout}`;

      if (expected === 'RETURN') {
        expect(out).toContain('RESULT=RETURN');
        expect(r.status).toBe(0);
      } else {
        expect(out).toContain('RESULT=THROW');
        expect(out).toMatch(REFUSAL);
        expect(out).toContain(`PGDATABASE=${observed}`);
        expect(r.status).not.toBe(0);
      }
    }
  );

  it('does not read process.env internally (literal arg wins even with PGDATABASE set)', () => {
    const r = runChild(HELPER_SCRIPT, {
      __ARG__: 'synchroflow_test_literal',
      __HARNESS__: '1',
      PGDATABASE: 'synchroflow_db', // must be ignored by the helper
    });
    expect(`${r.stdout}`).toContain('RESULT=RETURN');
    expect(r.status).toBe(0);
  });
});

// ── 2. database.config MATRIX ────────────────────────────────────────────────

describe('@lasyncro/backend-core/config/database.config.js', () => {
  it('DB-A: NODE_ENV=test + harness + disposable PGDATABASE → resolves that DB', () => {
    const r = runChild(DBCONFIG_SCRIPT, {
      NODE_ENV: 'test',
      SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
      PGDATABASE: 'synchroflow_test_probe123',
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout}`).toContain('DB=synchroflow_test_probe123');
  });

  it('DB-B: NODE_ENV=test + harness + PGDATABASE lost → REFUSES, never resolves synchroflow_db', () => {
    const r = runChild(DBCONFIG_SCRIPT, {
      NODE_ENV: 'test',
      SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
      PGDATABASE: null, // unset — .env at cwd would otherwise supply synchroflow_db
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(REFUSAL);
    expect(`${r.stdout}`).not.toContain('DB=synchroflow_db');
    expect(`${r.stdout}`).not.toContain('DB=');
  });

  it('DB-C: NODE_ENV=test + no harness + explicit PGDATABASE=synchroflow_db → REFUSES', () => {
    const r = runChild(DBCONFIG_SCRIPT, {
      NODE_ENV: 'test',
      PGDATABASE: 'synchroflow_db',
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(REFUSAL);
    expect(`${r.stdout}`).not.toContain('DB=');
  });

  it('DB-D: NODE_ENV=test + no harness + PGDATABASE missing → legacy .env fallback preserved (synchroflow_db)', () => {
    const dir = makeDotenvFallbackDir();
    try {
      const r = runChild(
        DBCONFIG_SCRIPT,
        {
          NODE_ENV: 'test',
          PGDATABASE: null,
        },
        dir
      );
      expect(r.status).toBe(0);
      expect(`${r.stdout}`).toContain('DB=synchroflow_db');
      expect(`${r.stderr}`).not.toMatch(REFUSAL);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('DB-D2: NODE_ENV=test + no harness + PGDATABASE="" → existing FATAL missing-env, NOT a REFUSAL', () => {
    const r = runChild(DBCONFIG_SCRIPT, {
      NODE_ENV: 'test',
      PGDATABASE: '',
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toContain('FATAL: Missing required DB env vars');
    expect(`${r.stderr}`).not.toMatch(REFUSAL);
    expect(`${r.stdout}`).not.toContain('DB=');
  });

  it('DB-E: NODE_ENV=development → unchanged development resolution (.env → synchroflow_db)', () => {
    const dir = makeDotenvFallbackDir();
    try {
      const r = runChild(
        DBCONFIG_SCRIPT,
        {
          NODE_ENV: 'development',
          PGDATABASE: null,
        },
        dir
      );
      expect(r.status).toBe(0);
      expect(`${r.stdout}`).toContain('DB=synchroflow_db');
      expect(`${r.stderr}`).not.toMatch(REFUSAL);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 3. system-db MATRIX ─────────────────────────────────────────────────────

describe('@lasyncro/backend-core/system-db.js', () => {
  it('SYS-A: NODE_ENV=test + harness + disposable PGDATABASE → import ok', () => {
    const r = runChild(SYSTEMDB_SCRIPT, {
      NODE_ENV: 'test',
      SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
      PGDATABASE: 'synchroflow_test_probe123',
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout}`).toContain('IMPORT_OK');
  });

  it('SYS-B: NODE_ENV=test + harness + PGDATABASE lost → REFUSES before pool build', () => {
    const r = runChild(SYSTEMDB_SCRIPT, {
      NODE_ENV: 'test',
      SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
      PGDATABASE: null,
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(REFUSAL);
    expect(`${r.stdout}`).not.toContain('IMPORT_OK');
  });

  it('SYS-C: NODE_ENV=test + no harness + explicit PGDATABASE=synchroflow_db → REFUSES', () => {
    const r = runChild(SYSTEMDB_SCRIPT, {
      NODE_ENV: 'test',
      PGDATABASE: 'synchroflow_db',
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(REFUSAL);
    expect(`${r.stdout}`).not.toContain('IMPORT_OK');
  });

  it('SYS-D: NODE_ENV=development → guard inert, import ok', () => {
    const r = runChild(SYSTEMDB_SCRIPT, {
      NODE_ENV: 'development',
      PGDATABASE: 'synchroflow_db',
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout}`).toContain('IMPORT_OK');
  });

  it('SYS-E: NODE_ENV=test + no harness + PGDATABASE missing → legacy import preserved', () => {
    const r = runChild(SYSTEMDB_SCRIPT, {
      NODE_ENV: 'test',
      PGDATABASE: null,
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout}`).toContain('IMPORT_OK');
    expect(`${r.stderr}`).not.toMatch(REFUSAL);
  });
});
