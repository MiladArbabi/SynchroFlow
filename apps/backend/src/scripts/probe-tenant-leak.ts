// apps/backend/src/scripts/probe-tenant-leak.ts
//
// ISS-RLS5 verification probe. Reconstructs the dev connection config
// directly from env (same vars/values as database.config.ts's development
// branch) instead of importing dbConfig through the @lasyncro/backend-core
// package boundary — ts-node 10.9.2's ESM loader fails to resolve wildcard
// subpath exports ("./config/*.js") even though the file exists and Node's
// own resolver would accept the pattern. Not chasing that separately; this
// avoids it entirely for a one-off diagnostic script.
//
// Run: node --loader ts-node/esm src/scripts/probe-tenant-leak.ts

import knex from 'knex';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const TENANT_A = 1;

async function main() {
  const probeDb = knex({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: String(process.env.PGPASSWORD || ''),
      database: process.env.PGDATABASE,
    },
    pool: { min: 1, max: 1, acquireTimeoutMillis: 10000, idleTimeoutMillis: 30000 },
  });

  try {
    console.log('[PROBE] Connection target:', process.env.PGHOST, process.env.PGDATABASE);
    console.log('[PROBE] Running withTenant-equivalent transaction for shop', TENANT_A);

    await probeDb.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
      const check = await trx.raw(
        `SELECT current_setting('app.current_tenant', true) as tenant`
      );
      console.log('[PROBE] Inside transaction, GUC reads:', check.rows[0].tenant);
      if (check.rows[0].tenant !== String(TENANT_A)) {
        throw new Error('SET LOCAL did not apply inside transaction — different failure mode');
      }
    });

    console.log('[PROBE] Transaction committed. Acquiring next connection (max:1 pool — must be same physical connection)...');

    const leakCheck = await probeDb.raw(
      `SELECT current_setting('app.current_tenant', true) as tenant`
    );
    const leaked = leakCheck.rows[0].tenant;

    console.log('[PROBE] Post-commit, same connection, GUC reads:', JSON.stringify(leaked));

    if (leaked === String(TENANT_A)) {
      console.error('[PROBE][FAIL] LEAK CONFIRMED: app.current_tenant persisted past COMMIT.');
      process.exitCode = 1;
    } else if (leaked === '' || leaked === null) {
      console.log('[PROBE][PASS] GUC is empty/unset after commit — SET LOCAL correctly scoped to the transaction.');
    } else {
      console.error('[PROBE][UNEXPECTED]', `GUC reads "${leaked}" — neither the tenant value nor empty. Investigate before trusting this result.`);
      process.exitCode = 1;
    }
  } finally {
    await probeDb.destroy();
  }
}

main().catch((err) => {
  console.error('[PROBE][ERROR]', err);
  process.exitCode = 1;
});