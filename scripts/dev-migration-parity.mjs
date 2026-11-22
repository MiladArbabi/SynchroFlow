/**
 * ENV-DB-PARITY-01 — Read-only development migration parity check.
 *
 * Compares the checked-out migration sources
 * (apps/backend/migrations/*.ts) with the local database ledger
 * (public.knex_migrations) and refuses development startup when they
 * differ.
 *
 * Guarantees:
 * - never migrates, resets, seeds or otherwise modifies the database;
 * - the session is opened with default_transaction_read_only=on and the
 *   ledger is read inside BEGIN READ ONLY ... ROLLBACK;
 * - uses the restricted application role (PGUSER), never the migration role;
 * - never prints credentials or connection URLs.
 *
 * Used only by the development backend supervisor
 * (scripts/dev-backend-entry.mjs). Production (`npm start`) and CI do not
 * load it. Importing this module performs no I/O.
 *
 * Standalone: `node scripts/dev-migration-parity.mjs`
 * (exit 0 = PASS, 1 = parity failure, 2 = database unavailable).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const MIGRATE_COMMAND =
  'npm run migrate --workspace ./apps/backend';

const LEDGER_TABLE = 'public.knex_migrations';

export class MigrationParityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationParityError';
    this.code = code;
    this.details = details;
    // The message is the actionable report; a stack trace adds noise.
    this.stack = `${this.name} [${code}]\n${message}`;
  }
}

/**
 * Lists checked-out migration sources as ledger names.
 * Knex records the compiled filename, so `<name>.ts` becomes `<name>.js`.
 */
export function listSourceMigrations(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map(file => `${file.slice(0, -3)}.js`)
    .sort();
}

/**
 * Pure comparison of source migrations and the applied ledger
 * (ledger in application order, i.e. ORDER BY id).
 *
 * - missing:    in source, not applied, after the newest applied migration
 *               (the database is behind the code).
 * - unexpected: applied, but absent from the checked-out source
 *               (the database was migrated from other code).
 * - divergent:  history that cannot be reconciled by migrating forward:
 *               unapplied migrations older than an applied one (gaps),
 *               duplicate ledger rows, or ledger order differing from
 *               source order.
 */
export function compareMigrationParity({ source, ledger }) {
  const sourceSorted = [...source].sort();
  const sourceSet = new Set(sourceSorted);
  const ledgerSet = new Set(ledger);

  const unexpected = ledger.filter(name => !sourceSet.has(name));

  const duplicates = [
    ...new Set(ledger.filter((name, index) => ledger.indexOf(name) !== index))
  ];

  const appliedKnown = ledger.filter(name => sourceSet.has(name));
  const newestApplied = appliedKnown.reduce(
    (max, name) => (name > max ? name : max),
    ''
  );

  const unapplied = sourceSorted.filter(name => !ledgerSet.has(name));
  const gaps = unapplied.filter(name => name < newestApplied);
  const missing = unapplied.filter(name => name > newestApplied);

  // Applied known migrations must appear in source order.
  const expectedOrder = sourceSorted.filter(name => ledgerSet.has(name));
  const dedupedApplied = appliedKnown.filter(
    (name, index) => appliedKnown.indexOf(name) === index
  );
  const outOfOrder = [];
  for (let index = 0; index < dedupedApplied.length; index++) {
    if (dedupedApplied[index] !== expectedOrder[index]) {
      outOfOrder.push(dedupedApplied[index]);
    }
  }

  const divergent = { gaps, duplicates, outOfOrder };
  const isDivergent =
    gaps.length > 0 || duplicates.length > 0 || outOfOrder.length > 0;

  return {
    ok: missing.length === 0 && unexpected.length === 0 && !isDivergent,
    sourceCount: sourceSorted.length,
    ledgerCount: ledger.length,
    newestSource: sourceSorted.at(-1) ?? null,
    newestApplied: newestApplied || null,
    missing,
    unexpected,
    divergent,
    isDivergent,
  };
}

function describeError(error) {
  // Node wraps multi-address connection failures in an AggregateError
  // whose own message is empty.
  const message =
    error?.message || error?.errors?.[0]?.message || String(error ?? 'error');
  return error?.code ? `${error.code}: ${message}` : message;
}

function bullet(names, limit = 10) {
  const shown = names.slice(0, limit).map(name => `    - ${name}`);
  if (names.length > limit) {
    shown.push(`    … and ${names.length - limit} more`);
  }
  return shown.join('\n');
}

/** Builds the actionable startup-blocking message. Never includes secrets. */
export function formatParityReport(result, { database = '(PGDATABASE)' } = {}) {
  const lines = [
    `[dev-migration-parity] BLOCKED: database "${database}" does not match ` +
      'the checked-out migrations.',
    `  Source migrations: ${result.sourceCount} ` +
      `(newest ${result.newestSource ?? 'none'})`,
    `  Applied in ledger: ${result.ledgerCount} ` +
      `(newest ${result.newestApplied ?? 'none'})`,
  ];

  if (result.missing.length > 0) {
    lines.push(
      '',
      `  MISSING — ${result.missing.length} migration(s) in source but not applied:`,
      bullet(result.missing),
      `  Fix: apply them deliberately with \`${MIGRATE_COMMAND}\`, then restart.`
    );
  }

  if (result.unexpected.length > 0) {
    lines.push(
      '',
      `  UNEXPECTED — ${result.unexpected.length} applied migration(s) not in this checkout:`,
      bullet(result.unexpected),
      '  Fix: the database was migrated from other code (another branch or',
      '  worktree). Check out code that contains these migrations, or point',
      '  PGDATABASE at a database that matches this checkout.'
    );
  }

  const { gaps, duplicates, outOfOrder } = result.divergent;
  if (result.isDivergent) {
    lines.push('', '  DIVERGENT — the ledger history cannot be reached by migrating forward:');
    if (gaps.length > 0) {
      lines.push(
        `   ${gaps.length} unapplied migration(s) older than the newest applied one:`,
        bullet(gaps)
      );
    }
    if (duplicates.length > 0) {
      lines.push('   duplicate ledger entries:', bullet(duplicates));
    }
    if (outOfOrder.length > 0) {
      lines.push('   applied out of source order:', bullet(outOfOrder));
    }
    lines.push(
      '  Fix: do not edit the ledger. Rebuild the development database',
      '  deliberately (for example `npm run dev:setup`, which DROPS it), or',
      '  check out the code the database was built from.'
    );
  }

  lines.push(
    '',
    '  Startup was stopped before compiling or starting the API/worker.',
    '  This check is read-only: nothing was migrated, reset or modified.'
  );

  return lines.join('\n');
}

/**
 * Resolves PG* connection settings from the process environment,
 * falling back to the canonical root ./.env (the same precedence as
 * dotenv.config: existing process values win). Does not mutate
 * process.env.
 */
export function resolveDevDatabaseConfig({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
} = {}) {
  let fileValues = {};
  const envPath = path.join(repoRoot, '.env');
  if (fs.existsSync(envPath)) {
    fileValues = require('dotenv').parse(fs.readFileSync(envPath));
  }

  const pick = key => {
    const value = env[key];
    return typeof value === 'string' && value.length > 0
      ? value
      : fileValues[key];
  };

  const config = {
    host: pick('PGHOST'),
    port: Number(pick('PGPORT') ?? 5432),
    user: pick('PGUSER'),
    password: pick('PGPASSWORD'),
    database: pick('PGDATABASE'),
  };

  const absent = ['host', 'user', 'database'].filter(key => !config[key]);
  if (absent.length > 0) {
    throw new MigrationParityError(
      'DEV_DATABASE_CONFIG_MISSING',
      '[dev-migration-parity] BLOCKED: cannot check migration parity — ' +
        `missing ${absent.map(key => `PG${key.toUpperCase()}`).join(', ')} ` +
        `in the environment and ${envPath}.`
    );
  }

  return config;
}

/**
 * Reads the applied ledger names in application order (ORDER BY id).
 * Returns [] when the ledger table does not exist.
 */
export async function readMigrationLedger(
  config,
  { createClient = cfg => new (require('pg').Client)(cfg) } = {}
) {
  const client = createClient({
    ...config,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    application_name: 'sf-dev-migration-parity',
    // Server-enforced: every transaction in this session is read-only.
    options: '-c default_transaction_read_only=on',
  });

  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => {});
    throw new MigrationParityError(
      'DEV_DATABASE_UNAVAILABLE',
      '[dev-migration-parity] BLOCKED: cannot connect to database ' +
        `"${config.database}" at ${config.host}:${config.port} as ` +
        `"${config.user}" (${describeError(error)}).\n` +
        '  Start the local PostgreSQL container and confirm PG* settings in ./.env.\n' +
        '  Startup was stopped before compiling or starting the API/worker.',
      { cause: error?.code }
    );
  }

  try {
    await client.query('BEGIN READ ONLY');
    try {
      const exists = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS present',
        [LEDGER_TABLE]
      );
      if (!exists.rows[0]?.present) return [];

      const result = await client.query(
        `SELECT name FROM ${LEDGER_TABLE} ORDER BY id`
      );
      return result.rows.map(row => row.name);
    } finally {
      await client.query('ROLLBACK');
    }
  } catch (error) {
    if (error instanceof MigrationParityError) throw error;
    throw new MigrationParityError(
      'DEV_DATABASE_UNAVAILABLE',
      '[dev-migration-parity] BLOCKED: could not read the migration ledger ' +
        `${LEDGER_TABLE} in "${config.database}" ` +
        `(${describeError(error)}).\n` +
        '  Startup was stopped before compiling or starting the API/worker.',
      { cause: error?.code }
    );
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Runs the full check. Resolves with the comparison when source and ledger
 * match; otherwise rejects with MigrationParityError.
 */
export async function assertDevMigrationParity({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  listSource = listSourceMigrations,
  readLedger = readMigrationLedger,
  log = message => console.log(message),
} = {}) {
  const config = resolveDevDatabaseConfig({ repoRoot, env });
  const source = listSource(path.join(repoRoot, 'apps/backend/migrations'));
  const ledger = await readLedger(config);
  const result = compareMigrationParity({ source, ledger });

  if (!result.ok) {
    throw new MigrationParityError(
      'DEV_MIGRATION_PARITY_FAILED',
      formatParityReport(result, { database: config.database }),
      result
    );
  }

  log(
    `[dev-migration-parity] PASS: ${result.ledgerCount}/${result.sourceCount} ` +
      `migrations applied (newest ${result.newestApplied ?? 'none'}).`
  );
  return result;
}

const directlyExecuted =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (directlyExecuted) {
  assertDevMigrationParity().then(
    () => {
      process.exitCode = 0;
    },
    error => {
      console.error(error?.message ?? error);
      process.exitCode =
        error?.code === 'DEV_MIGRATION_PARITY_FAILED' ? 1 : 2;
    }
  );
}
