// packages/backend-core/src/db.ts

import knex from 'knex';
import type { Knex } from 'knex';
import dbConfig from './config/database.config.js';
import {
  getTenantContextShopId,
  runWithTenantContext,
} from './tenant-context.js';

const baseDb = knex(dbConfig);
export { runWithTenantContext };

function guardTenantQuery(target: Knex, queryBuilder: any) {
  const originalThen = queryBuilder.then.bind(queryBuilder);

  queryBuilder.then = async function (...args: any[]) {
    // BYPASS: allow explicitly marked system queries (bootstrap, auth, infra)
    if (queryBuilder.__skipTenantCheck) {
      return originalThen(...args);
    }

    const requestTenant = getTenantContextShopId();
    const markedTenant = queryBuilder.__expectedTenant;
    const expectedTenant = Number(markedTenant ?? requestTenant);

    if (!Number.isInteger(expectedTenant) || expectedTenant <= 0) {
      throw new Error(
        'TENANT_CONTEXT_MISSING: app.current_tenant is missing or zero. Query blocked.'
      );
    }

    if (
      markedTenant !== undefined &&
      requestTenant !== undefined &&
      Number(markedTenant) !== requestTenant
    ) {
      throw new Error(
        'TENANT_CONTEXT_MISMATCH: app.current_tenant is mismatched. Query blocked.'
      );
    }

    return target.transaction(async (trx) => {
      await setTenantContext(trx, expectedTenant);
      queryBuilder.transacting(trx);
      return originalThen(...args);
    });
  };

  return queryBuilder;
}

// --- TENANT CONTEXT GUARD (MANDATORY) ---
const db = new Proxy(baseDb, {
  apply(target, thisArg, argumentsList) {
    return guardTenantQuery(
      target,
      Reflect.apply(target, thisArg, argumentsList)
    );
  },
  get(target, property, receiver) {
    // `db.raw()` is a property call, so an apply-only Proxy never sees it.
    // Wrap Raw objects too; otherwise every awaited raw statement silently
    // bypasses the application guard.
    if (property === 'raw') {
      return (...args: any[]) =>
        guardTenantQuery(target, (target.raw as any)(...args));
    }

    if (property === 'transaction') {
      return (handler: any, config?: any) => {
        const shopId = getTenantContextShopId();
        if (!shopId || typeof handler !== 'function') {
          return (target.transaction as any)(handler, config);
        }

        return target.transaction(async (trx) => {
          await setTenantContext(trx, shopId);
          return handler(trx);
        }, config);
      };
    }

    return Reflect.get(target, property, receiver);
  },
});

// --- SYSTEM QUERY BYPASS (EXPLICIT ONLY) ---
/**
 * SYSTEM QUERY BYPASS (EXPLICIT ONLY)
 * -----------------------------------
 * Use ONLY for:
 * - bootstrap
 * - auth (pre-tenant)
 * - migrations / infra
 *
 * NEVER use in domain logic.
 */
export function systemQuery(qb: any) {
  qb.__skipTenantCheck = true;
  return qb;
}

/**
 * Explicit pre-tenant transaction for narrowly scoped authentication and
 * OAuth state operations. PostgreSQL RLS still applies; this only makes the
 * application-level exception visible and reviewable.
 */
export function systemTransaction<T>(
  fn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return baseDb.transaction(fn);
}

/**
 * Mark a pooled query as belonging to one expected tenant.
 *
 * Prefer withTenant(). This helper exists for callers that already own a
 * correctly scoped connection and need the application guard to verify it.
 */
export function tenantQuery<T>(shopId: number, qb: T): T {
  assertValidShopId(shopId);
  (qb as any).__expectedTenant = shopId;
  return qb;
}

const isJest =
  process.env.JEST_WORKER_ID !== undefined ||
  process.env.NODE_ENV === 'test';

// --- SAFE BOOTSTRAP (NO TENANT CONTEXT REQUIRED) ---
if (!isJest && process.env.NODE_ENV !== 'production') {
  systemQuery(
    db.raw(`
      SELECT current_database() as database,
             inet_server_addr() as host,
             inet_server_port() as port
    `)
  )
    .then((r: any) => {
      console.log(
        `Database connected successfully in ${
          process.env.NODE_ENV || 'development'
        } mode.`
      );
      console.log('[DB_IDENTITY]', r.rows[0]);
    })
    .catch((err: unknown) => {
      console.error('DATABASE CONNECTION FAILED');
      console.error(err);
    });
}

// --- TENANT CONTEXT SETTER (MANDATORY ENTRYPOINT) ---
function assertValidShopId(shopId: number): void {
  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new Error('INVALID_TENANT_CONTEXT');
  }
}

export async function setTenantContext(
  trx: Knex.Transaction,
  shopId: number
): Promise<void> {
  assertValidShopId(shopId);

  await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [
    String(shopId),
  ]);

  const check = await trx.raw(
    `SELECT current_setting('app.current_tenant', true) AS tenant`
  );

  if (check?.rows?.[0]?.tenant !== String(shopId)) {
    throw new Error('FAILED_TO_SET_APP_CURRENT_TENANT');
  }
}

export async function withTenant<T>(
  shopId: number,
  fn: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  assertValidShopId(shopId);

  return baseDb.transaction(async (trx) => {
    // NOTE:
    // PostgreSQL SET does NOT support parameter binding.
    // shopId is numeric and controlled → safe to inline.
    // SEC-FIX (ISS-SEC1): SET LOCAL scopes the setting to this transaction
    // only — Postgres automatically discards it on COMMIT or ROLLBACK.
    // Plain SET persists on the physical connection and leaks to whatever
    // request the pool hands that connection to next. Verified via
    // tenant-leak-test.ts: prior to this fix, 25/25 unrelated queries on a
    // reused connection inherited a stale tenant context after commit.
    await setTenantContext(trx, shopId);

    return fn(trx);
  });
}

// NOTE:
// - REQUIRED for all writes and reads
// - Ensures RLS works
// - Prevents silent failures

export default db;

export interface RuntimeDatabaseIdentity {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

export async function getRuntimeDatabaseIdentity(): Promise<RuntimeDatabaseIdentity> {
  const result = await baseDb.raw(`
    SELECT
      current_user,
      role.rolsuper,
      role.rolbypassrls
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `);

  const identity = result?.rows?.[0];
  if (!identity) {
    throw new Error('RUNTIME_DATABASE_IDENTITY_UNAVAILABLE');
  }

  return identity;
}

export async function assertRuntimeDatabaseIdentity(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.DATABASE_URL) {
    throw new Error(
      'FATAL_PRIVILEGED_DATABASE_CREDENTIAL_PRESENT: DATABASE_URL must not exist in an application runtime.'
    );
  }

  const identity = await getRuntimeDatabaseIdentity();
  if (
    identity.current_user !== 'sf_app' ||
    identity.rolsuper !== false ||
    identity.rolbypassrls !== false
  ) {
    throw new Error(
      `FATAL_RUNTIME_DATABASE_IDENTITY: expected sf_app/NOSUPERUSER/NOBYPASSRLS, got ${JSON.stringify(identity)}`
    );
  }

  console.info('[DB_RUNTIME_IDENTITY_VERIFIED]', identity);
}
