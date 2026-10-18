import pg from 'pg';
import type { PoolClient } from 'pg';
import { encrypt } from '../../security/encryption.service.js';
import { normalizeAndValidateShopifyGrantedScopes } from './shopifyScopes.js';
import type { ShopifyOAuthAcquisition } from './shopifyOAuthAcquisition.service.js';
import type { ShopifyAdminCredentialReconnectOwner } from './shopifyAdminCredential.repository.js';

const EXECUTOR = 'sf_shopify_reconnect_executor';
const failure = () => new Error('SHOPIFY_RECONNECT_EXECUTOR_REJECTED');
let pool: pg.Pool | undefined;
let closed = false;

function executorPool(): pg.Pool {
  if (closed) throw failure();
  if (!pool) {
    // A complete dedicated URL is mandatory: never inherit app/PG connection defaults.
    const connectionString = process.env.SHOPIFY_RECONNECT_DATABASE_URL;
    if (!connectionString) throw failure();
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || decodeURIComponent(url.username) !== EXECUTOR
      || !url.hostname || url.pathname.length <= 1 || !url.password
      || [...url.searchParams.keys()].some(key => key !== 'sslmode')
      || (sslmode !== null && !['disable', 'require', 'verify-full'].includes(sslmode))) throw failure();
    pool = new pg.Pool({
      // Explicit URL-derived fields prevent PG* defaults or URL options from
      // replacing the identity, timeouts or transport verification policy.
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent(url.pathname.slice(1)),
      user: EXECUTOR,
      password: decodeURIComponent(url.password),
      ssl: sslmode === 'disable' ? false : { rejectUnauthorized: true },
      max: 2,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 5_000,
      lock_timeout: 2_000,
      query_timeout: 6_000,
      idle_in_transaction_session_timeout: 5_000,
      application_name: 'shopify-reconnect-executor',
      options: '-c search_path=pg_catalog,pg_temp',
    });
    // pg removes failed idle clients. Never emit raw driver diagnostics or URLs.
    pool.on('error', () => undefined);
  }
  return pool;
}

async function attest(client: PoolClient): Promise<void> {
  const result = await client.query(`
    SELECT session_user::text AS session_role, current_user::text AS current_role,
      r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
      r.rolreplication,
      pg_catalog.has_schema_privilege(current_user, 'shopify_reconnect_private', 'USAGE') AS schema_usage,
      pg_catalog.has_function_privilege(current_user,
        'shopify_reconnect_private.finalize_reconnect(integer,integer,text,text,bigint,uuid,text,text,timestamptz,timestamptz,text,text,text,text)',
        'EXECUTE') AS finalizer_execute,
      EXISTS (SELECT 1 FROM pg_catalog.pg_roles other
              WHERE other.oid <> r.oid
                AND pg_catalog.pg_has_role(r.oid, other.oid, 'MEMBER')) AS has_membership
    FROM pg_catalog.pg_roles r WHERE r.rolname = session_user
  `);
  const role = result.rows[0];
  if (result.rows.length !== 1 || role.session_role !== EXECUTOR
    || role.current_role !== EXECUTOR || role.rolcanlogin !== true
    || role.rolsuper !== false || role.rolbypassrls !== false
    || role.rolcreaterole !== false || role.rolcreatedb !== false
    || role.rolreplication !== false || role.has_membership !== false
    || role.schema_usage !== true || role.finalizer_execute !== true) throw failure();
}

/** Authenticate and attest a real E session before any reconnect provider acquisition. */
export async function assertShopifyReconnectExecutorReady(): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await executorPool().connect();
    await attest(client);
  } catch {
    if (client) { client.release(true); client = undefined; }
    throw failure();
  } finally {
    client?.release();
  }
}

const FINALIZE = `SELECT generation::text AS generation, integration_id
  FROM shopify_reconnect_private.finalize_reconnect(
    $1::integer, $2::integer, $3::text, $4::text, $5::bigint, $6::uuid,
    $7::text, $8::text, $9::timestamptz, $10::timestamptz,
    $11::text, $12::text, $13::text, $14::text)`;

/** Only this driver's finalizer rejection can produce STALE_RESULT; no caller error seam. */
export async function executeShopifyReconnectFinalizer(
  owner: ShopifyAdminCredentialReconnectOwner,
  credentials: ShopifyOAuthAcquisition,
): Promise<{ kind: 'RECONNECTED'; generation: string; integration: { id: number } }
  | { kind: 'STALE_RESULT' }> {
  let client: PoolClient | undefined;
  try {
    // Keep bigint exact at both boundaries, independent of global pg type parsers.
    if (typeof owner.generation !== 'string' || !/^(0|[1-9][0-9]*)$/.test(owner.generation)
      || BigInt(owner.generation) > 9223372036854775807n) throw failure();
    const scopes = normalizeAndValidateShopifyGrantedScopes(credentials.grantedScopes);
    const access = encrypt(credentials.accessToken);
    const refresh = encrypt(credentials.refreshToken);
    client = await executorPool().connect();
    await attest(client);
    await client.query('BEGIN');
    let result;
    try {
      result = await client.query(FINALIZE, [
        owner.shopId, owner.installationId, owner.shopDomain, owner.installationState,
        owner.generation, owner.leaseToken, access, refresh,
        credentials.accessExpiresAt, credentials.refreshExpiresAt, scopes,
        credentials.shopIdentity.gid, credentials.shopIdentity.currencyCode,
        credentials.shopIdentity.ianaTimezone,
      ]);
    } catch (error: unknown) {
      // Classify exclusively errors from the actual invocation, never attestation/COMMIT.
      if (error instanceof pg.DatabaseError
        && error.code === 'PZ101'
        && error.message === 'SHOPIFY_RECONNECT_STALE_OWNER') {
        await client.query('ROLLBACK');
        return { kind: 'STALE_RESULT' };
      }
      throw failure();
    }
    const row = result.rows[0];
    if (result.rows.length !== 1 || row.generation !== owner.generation
      || !Number.isSafeInteger(row.integration_id) || row.integration_id <= 0) throw failure();
    await client.query('COMMIT');
    return { kind: 'RECONNECTED', generation: row.generation, integration: { id: row.integration_id } };
  } catch {
    // Destroy rather than reuse an uncertain/failed transaction; disconnect rolls it back.
    if (client) { client.release(true); client = undefined; }
    throw failure();
  } finally {
    client?.release();
  }
}

export async function closeShopifyReconnectExecutor(): Promise<void> {
  closed = true;
  const active = pool;
  pool = undefined;
  try { await active?.end(); } catch { throw failure(); }
}
