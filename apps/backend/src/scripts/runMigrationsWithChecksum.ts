import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const knexConfig = (await import(
  path.resolve(__dirname, '../../../knexfile.cjs')
)).default;

import knex, { type Knex } from 'knex';
import { execSync } from 'child_process';

/**
 * MIGRATION RUNNER WITH CHECKSUM ENFORCEMENT
 * ------------------------------------------
 * Guarantees:
 * - No migration file is modified after execution
 * - DB state matches codebase exactly
 */

const env = process.env.NODE_ENV || 'development';
const db = knex(knexConfig[env]);

// Resolve dist/migrations relative to compiled script location (context-independent)
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

console.info('[migration-runner] resolved MIGRATIONS_DIR=', MIGRATIONS_DIR);

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const RECONNECT_BOUNDARY = '20261016120000_0212_authorize_shopify_reconnect_sync_reset.js';
const RECONNECT_CORRECTION = '20261016150000_0215_harden_reconnect_and_priority_function_authority.js';

async function validateChecksums(connection: Knex): Promise<void> {
  if (!(await connection.schema.withSchema('public').hasTable('migration_checksums'))) return;
  for (const { name, checksum } of await connection('public.migration_checksums').select('name', 'checksum')) {
    const filePath = path.join(MIGRATIONS_DIR, name);
    if (path.basename(name) !== name || !fs.existsSync(filePath) || hashFile(filePath) !== checksum) {
      throw new Error(`[MIGRATION_DRIFT_DETECTED] ${name} has been modified or is missing`);
    }
  }
}

function assertProtectedOrder(files: string[], completed: string[]): string[] {
  const boundaryIndex = files.indexOf(RECONNECT_BOUNDARY);
  const correctionIndex = files.indexOf(RECONNECT_CORRECTION);
  const laterCompleted = completed.filter(file => file > RECONNECT_CORRECTION);
  const laterFiles = files.filter(file => file > RECONNECT_CORRECTION);
  if (new Set(files).size !== files.length ||
      files.some((file, index) => index > 0 && file <= files[index - 1]) ||
      boundaryIndex < 0 || correctionIndex !== boundaryIndex + 1 ||
      new Set(completed).size !== completed.length ||
      completed.some(file => !files.includes(file)) ||
      (completed.includes(RECONNECT_CORRECTION) && !completed.includes(RECONNECT_BOUNDARY)) ||
      (completed.includes(RECONNECT_CORRECTION) &&
        completed.indexOf(RECONNECT_CORRECTION) < completed.indexOf(RECONNECT_BOUNDARY)) ||
      (completed.includes(RECONNECT_BOUNDARY) &&
        files.some(file => file < RECONNECT_BOUNDARY &&
          (!completed.includes(file) || completed.indexOf(file) > completed.indexOf(RECONNECT_BOUNDARY)))) ||
      (laterCompleted.length > 0 &&
        (!completed.includes(RECONNECT_CORRECTION) ||
          completed.indexOf(laterCompleted[0]) < completed.indexOf(RECONNECT_CORRECTION))) ||
      laterCompleted.some((file, index) => file !== laterFiles[index])) {
    throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] unsupported migration ordering');
  }
  return [RECONNECT_BOUNDARY, RECONNECT_CORRECTION].filter(file => !completed.includes(file));
}

function assertNoTransactionControl(sql: string): void {
  // Inspect top-level SQL, excluding comments, quoted strings/identifiers and
  // dollar-quoted function bodies. PostgreSQL disallows transaction termination
  // inside functions/DO executed within our explicit transaction.
  const topLevel = sql.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\$([A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?\$\1\$/g,
    ' '
  );
  if (topLevel.split(';').some(statement =>
    /^\s*(BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|END\b|ABORT\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b|PREPARE\s+TRANSACTION\b|SET\s+(?:(?:LOCAL|SESSION)\s+)?TRANSACTION\b)/i.test(statement))) {
    throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] transaction-control SQL');
  }
}

async function migrateWithProtectedTail(files: string[]): Promise<void> {
  const migrationConfig = knexConfig[env].migrations;
  if (migrationConfig.tableName !== 'knex_migrations' ||
      (migrationConfig.schemaName && migrationConfig.schemaName !== 'public') ||
      migrationConfig.disableTransactions || migrationConfig.migrationSource ||
      path.resolve(migrationConfig.directory) !== MIGRATIONS_DIR) {
    throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] unsupported Knex configuration');
  }
  const completed = await db.schema.withSchema('public').hasTable('knex_migrations')
    ? (await db('public.knex_migrations').select('name').orderBy('id')).map(row => row.name as string)
    : [];
  assertProtectedOrder(files, completed);
  await validateChecksums(db);

  // Knex 3.3.0 Migrator.before() bounds the historic batch strictly before 0212.
  // Unlike unrestricted latest(), its mixed transaction policy cannot commit
  // 0212 separately. Preserve that historic policy on the pre-boundary files.
  await db.migrate.before({ name: RECONNECT_BOUNDARY });

  const modules = new Map<string, {
    config?: { transaction?: boolean };
    up: (connection: Knex) => Promise<void>;
    assertSecurityPostconditions?: (connection: Knex) => Promise<void>;
  }>();
  for (const name of [RECONNECT_BOUNDARY, RECONNECT_CORRECTION]) {
    const migration = await import(pathToFileURL(path.join(MIGRATIONS_DIR, name)).href);
    if (migration.config?.transaction === false || typeof migration.up !== 'function') {
      throw new Error(`[PROTECTED_MIGRATION_TAIL_INVALID] ${name} must be transactional`);
    }
    modules.set(name, migration);
  }
  const assertSecurity = modules.get(RECONNECT_CORRECTION)?.assertSecurityPostconditions;
  if (typeof assertSecurity !== 'function') {
    throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] missing security postconditions');
  }

  await db.transaction(async trx => {
    // Same lock row and ledger shape as installed Knex Migrator._runBatch /
    // _waterfallBatch. Both ledger registrations are on this exact connection.
    await trx.raw('LOCK TABLE public.knex_migrations_lock IN EXCLUSIVE MODE');
    const lockRows = await trx('public.knex_migrations_lock').select('is_locked').forUpdate();
    if (lockRows.length !== 1 || lockRows[0].is_locked !== 0) {
      throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] migration lock unavailable');
    }
    await trx('public.knex_migrations_lock').update({ is_locked: 1 });
    const applied = await trx('public.knex_migrations').select('name').orderBy('id');
    const pending = assertProtectedOrder(files, applied.map(row => row.name as string));
    await validateChecksums(trx);
    if (!(await trx.schema.withSchema('public').hasTable('migration_checksums'))) {
      throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] checksum ledger missing');
    }

    // Migration bodies receive only guarded raw(), never a pool, commit(),
    // rollback(), transaction() or connection escape. Both approved UP bodies
    // use raw SQL exclusively. Ledger/checksum work retains the real trx here.
    const migrationConnection = Object.freeze({
      raw: async (sql: string, bindings?: Knex.RawBinding[]) => {
        if (typeof sql !== 'string') {
          throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] non-string SQL');
        }
        assertNoTransactionControl(sql);
        return bindings === undefined ? trx.raw(sql) : trx.raw(sql, bindings);
      },
    }) as unknown as Knex;
    if (pending.length > 0) {
      // The external deployment-quiescence prerequisite remains mandatory for
      // already-applied 0212; table locks also exclude in-flight table writes.
      await trx.raw(`LOCK TABLE public.shops, public.shopify_app_installations,
        public.shopify_admin_credentials, public.integrations IN ACCESS EXCLUSIVE MODE`);
      const [{ max_batch: maxBatch }] = await trx('public.knex_migrations').max('batch as max_batch');
      const batch = Number(maxBatch ?? 0) + 1;
      for (const name of pending) {
        await modules.get(name)!.up(migrationConnection);
        await trx('public.knex_migrations').insert({ name, batch, migration_time: new Date() });
      }
    }

    // Never merge/overwrite a historical checksum. A conflict must match the
    // stored value and is checked again before the enclosing COMMIT.
    for (const { name } of await trx('public.knex_migrations').select('name').orderBy('id')) {
      await trx('public.migration_checksums').insert({
        name, checksum: hashFile(path.join(MIGRATIONS_DIR, name)),
      }).onConflict('name').ignore();
    }
    await validateChecksums(trx);
    await assertSecurity(migrationConnection);
    const registered = await trx('public.knex_migrations')
      .whereIn('name', [RECONNECT_BOUNDARY, RECONNECT_CORRECTION]).count('* as count');
    if (Number(registered[0].count) !== 2) {
      throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] incomplete protected ledger');
    }
    await trx('public.knex_migrations_lock').update({ is_locked: 0 });
    console.info('[migration-runner] protected tail prepared', { pending });
  });
  console.info('[migration-runner] protected tail/checksums committed');
  // This call is deliberately outside/after the awaited protected transaction.
  await migrateAfterCorrection(files, assertSecurity);
}

async function reconnectCatalogSnapshot(connection: Knex): Promise<string> {
  // Capture authority metadata only, never merchant rows or credential values.
  // A later migration intentionally changing this boundary needs contract review.
  const result = await connection.raw(`
    SELECT c.relname, c.relkind, c.relowner, c.relacl::text, c.reloptions,
      c.relrowsecurity, c.relforcerowsecurity,
      (SELECT jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid)
       FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policies,
      (SELECT jsonb_agg(jsonb_build_object(
         'trigger', pg_catalog.to_jsonb(t), 'function', pg_catalog.pg_get_functiondef(t.tgfoid)
       ) ORDER BY t.oid) FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers,
      (SELECT jsonb_agg(jsonb_build_object('column', pg_catalog.to_jsonb(a),
                         'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid))
                       ORDER BY a.attnum)
       FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
         ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
      (SELECT jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) ORDER BY k.oid)
       FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid) AS constraints
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (
      'shops', 'shopify_app_installations', 'shopify_admin_credentials', 'integrations'
    ) ORDER BY c.relname
  `);
  return JSON.stringify(result.rows);
}

async function migrateAfterCorrection(
  files: string[], assertSecurity: (connection: Knex) => Promise<void>
): Promise<void> {
  for (const name of files.filter(file => file > RECONNECT_CORRECTION)) {
    await db.transaction(async trx => {
      await trx.raw('LOCK TABLE public.knex_migrations_lock IN EXCLUSIVE MODE');
      const lockRows = await trx('public.knex_migrations_lock').select('is_locked').forUpdate();
      if (lockRows.length !== 1 || lockRows[0].is_locked !== 0) {
        throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] migration lock unavailable');
      }
      await trx('public.knex_migrations_lock').update({ is_locked: 1 });
      const completed = (await trx('public.knex_migrations').select('name').orderBy('id'))
        .map(row => row.name as string);
      if (assertProtectedOrder(files, completed).length !== 0) {
        throw new Error('[PROTECTED_MIGRATION_TAIL_INVALID] correction must commit first');
      }
      await validateChecksums(trx);
      await assertSecurity(trx);
      if (!completed.includes(name)) {
        const migration = await import(pathToFileURL(path.join(MIGRATIONS_DIR, name)).href);
        if ((migration.config?.transaction !== undefined && migration.config.transaction !== true) ||
            typeof migration.up !== 'function' || typeof migration.down !== 'function') {
          throw new Error(`[PROTECTED_MIGRATION_TAIL_INVALID] ${name} requires a transactional migration`);
        }
        await trx.raw(`LOCK TABLE public.shops, public.shopify_app_installations,
          public.shopify_admin_credentials, public.integrations IN ACCESS EXCLUSIVE MODE`);
        const authorityBefore = await reconnectCatalogSnapshot(trx);
        let transactionViolation: Error | undefined;
        const guardQuery = (query: { sql: string }) => {
          try { assertNoTransactionControl(query.sql); }
          catch (error) { transactionViolation = error as Error; throw error; }
        };
        // Knex 3.3.0 emits client 'query' synchronously before driver execution,
        // covering raw(), schema and query builders on this connection.
        trx.client.on('query', guardQuery);
        const migrationConnection = new Proxy(trx, {
          get(target, property, receiver) {
            if (['commit', 'rollback', 'transaction', 'savepoint', 'destroy', 'migrate'].includes(String(property))) {
              transactionViolation = new Error('[PROTECTED_MIGRATION_TAIL_INVALID] migration transaction ownership');
              throw transactionViolation;
            }
            return Reflect.get(target, property, receiver);
          },
        });
        try { await migration.up(migrationConnection); }
        finally { trx.client.removeListener('query', guardQuery); }
        if (transactionViolation) throw transactionViolation;
        await assertSecurity(trx);
        if (await reconnectCatalogSnapshot(trx) !== authorityBefore) {
          throw new Error(`[RECONNECT_SECURITY_BOUNDARY_CHANGED] ${name} requires contract review`);
        }
        const [{ max_batch: maxBatch }] = await trx('public.knex_migrations').max('batch as max_batch');
        await trx('public.knex_migrations').insert({ name, batch: Number(maxBatch ?? 0) + 1, migration_time: new Date() });
        await trx('public.migration_checksums').insert({
          name, checksum: hashFile(path.join(MIGRATIONS_DIR, name)),
        }).onConflict('name').ignore();
        await validateChecksums(trx);
        const registered = (await trx('public.knex_migrations').select('name').orderBy('id'))
          .map(row => row.name as string);
        assertProtectedOrder(files, registered);
      }
      await trx('public.knex_migrations_lock').update({ is_locked: 0 });
    });
  }
}

async function assertProductionRlsBoundary(): Promise<void> {
  const roleResult = await db.raw(`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'sf_app'
  `);
  const appRole = roleResult.rows[0];

  if (
    !appRole ||
    appRole.rolsuper !== false ||
    appRole.rolbypassrls !== false
  ) {
    throw new Error(
      `[RLS_RELEASE_GATE_FAILED] sf_app must be NOSUPERUSER/NOBYPASSRLS: ${JSON.stringify(appRole ?? null)}`
    );
  }

  const invariantResult = await db.raw(`
    SELECT
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE c.relrowsecurity AND NOT c.relforcerowsecurity
      ) AS enabled_not_forced,
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE NOT c.relrowsecurity
          AND EXISTS (
            SELECT 1
            FROM pg_attribute a
            WHERE a.attrelid = c.oid
              AND a.attname = 'shop_id'
              AND a.attnum > 0
              AND NOT a.attisdropped
          )
      ) AS shop_id_without_rls,
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE c.relrowsecurity
          AND NOT EXISTS (
            SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
          )
      ) AS rls_without_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  `);

  const invariants = invariantResult.rows[0];

  const unsafePolicyResult = await db.raw(`
    SELECT
      c.relname AS table_name,
      p.polname AS policy_name,
      p.polcmd AS policy_command,
      pg_get_expr(p.polqual, p.polrelid) AS using_expression,
      pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        c.relname = 'shops'
        OR EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'shop_id'
            AND a.attnum > 0
            AND NOT a.attisdropped
        )
      )
      AND (
        (
          COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~* 'current_tenant'
          AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
            ~* '(''0''::text|IS NULL|= ANY)'
        )
        OR (
          p.polcmd IN ('*', 'a')
          AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'
        )
      )
    ORDER BY c.relname, p.polname
  `);

  const violations = {
    enabledNotForced: invariants.enabled_not_forced ?? [],
    shopIdWithoutRls: invariants.shop_id_without_rls ?? [],
    rlsWithoutPolicy: invariants.rls_without_policy ?? [],
    unsafePolicies: unsafePolicyResult.rows,
  };

  if (Object.values(violations).some((tables) => tables.length > 0)) {
    throw new Error(
      `[RLS_RELEASE_GATE_FAILED] schema invariants: ${JSON.stringify(violations)}`
    );
  }

  const tenantTablesResult = await db.raw(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND (
        c.relname = 'shops'
        OR EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'shop_id'
            AND a.attnum > 0
            AND NOT a.attisdropped
        )
      )
    ORDER BY c.relname
  `);

  const tenantTables: Array<{ table_name: string }> = tenantTablesResult.rows;
  const visibleTables: string[] = [];
  const visibleAtZero: string[] = [];
  const visibleWithoutTenant: string[] = [];

  await db.transaction(async (trx) => {
    await trx.raw('SET LOCAL ROLE sf_app');
    await trx.raw(
      `SELECT set_config('app.current_tenant', '2147483647', true)`
    );

    const identityResult = await trx.raw(`
      SELECT current_user,
             current_setting('app.current_tenant', true) AS current_tenant
    `);
    const identity = identityResult.rows[0];

    if (
      identity.current_user !== 'sf_app' ||
      identity.current_tenant !== '2147483647'
    ) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] invalid probe identity: ${JSON.stringify(identity)}`
      );
    }

    for (const { table_name: tableName } of tenantTables) {
      const result = await trx.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM public.${quoteIdentifier(tableName)}
          LIMIT 1
        ) AS visible
      `);

      if (result.rows[0]?.visible === true) {
        visibleTables.push(tableName);
      }
    }

    if (visibleTables.length > 0) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] sf_app invalid-tenant visibility: ${JSON.stringify(visibleTables)}`
      );
    }

    await trx.raw(`SELECT set_config('app.current_tenant', '0', true)`);
    for (const { table_name: tableName } of tenantTables) {
      const result = await trx.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM public.${quoteIdentifier(tableName)}
          LIMIT 1
        ) AS visible
      `);
      if (result.rows[0]?.visible === true) visibleAtZero.push(tableName);
    }

    if (visibleAtZero.length > 0) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] sf_app tenant-zero visibility: ${JSON.stringify(visibleAtZero)}`
      );
    }

    await trx.raw(`SELECT set_config('app.current_tenant', '', true)`);
    for (const { table_name: tableName } of tenantTables) {
      try {
        const result = await trx.transaction((probe) =>
          probe.raw(`
            SELECT EXISTS (
              SELECT 1
              FROM public.${quoteIdentifier(tableName)}
              LIMIT 1
            ) AS visible
          `)
        );
        if (result.rows[0]?.visible === true) {
          visibleWithoutTenant.push(tableName);
        }
      } catch (error: any) {
        // Older strict policies cast the empty setting to integer and raise
        // 22P02. That is fail-closed, not visibility; every other error is a
        // release blocker.
        if (error?.code !== '22P02') throw error;
      }
    }

    if (visibleWithoutTenant.length > 0) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] sf_app missing-tenant visibility: ${JSON.stringify(visibleWithoutTenant)}`
      );
    }
  });

  console.info('[migration-runner] RLS release gate passed', {
    appRole,
    testedTenant: 2147483647,
    testedTables: tenantTables.length,
    tenantZeroTables: tenantTables.length,
    missingTenantTables: tenantTables.length,
  });
}

async function main() {
  console.info('[migration-runner] start');

  /**
   * RLS ENFORCEMENT (NON-BYPASSABLE)
   * --------------------------------
   * MUST run before any migration or DB state interaction.
   * Prevents schema drift without RLS guarantees.
   */
  try {
    console.info('[migration-runner] running RLS check...');
    
    // Resolve relative to this script (same strategy as migrations)
    const rlsScriptPath = path.resolve(__dirname, '../../../scripts/check_rls.sh');

    console.info('[migration-runner] resolved RLS script path=', rlsScriptPath);

    if (!fs.existsSync(rlsScriptPath)) {
      console.error('[migration-runner] RLS script not found at:', rlsScriptPath);
      process.exit(1);
    }

    execSync(`bash ${rlsScriptPath}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[migration-runner] RLS CHECK FAILED — aborting');
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js')).sort();
  await migrateWithProtectedTail(files);

  console.info('[migration-runner] checksum sync complete');

  await assertProductionRlsBoundary();

  await db.destroy();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migration-runner] failed', err);
    process.exit(1);
  });
