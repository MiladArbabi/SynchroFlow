/**
 * AUTH-SESSION-01 — D02 atomic refresh rotation + D05 logout / session revocation.
 *
 * Ratified contract (RED regression evidence; no production change in this file's phase):
 *
 *   D02-1  Two concurrent refreshes of the same token: exactly one rotation,
 *          zero orphan children; detected replay revokes the winning child.
 *   D02-2  A transaction failure during rotation: old token stays active, no
 *          child row survives, 503 retryable.
 *   D02-3  The issued session must stay aligned with the token's shop: a
 *          membership in a different shop never yields a child token
 *          -> 403 { error: 'SHOP_CONTEXT_MISMATCH' }.
 *   D02-4  Session lineage (session_id) is stable across rotations.
 *   D02-5  Consecutive refresh JWTs are unique even within the same second.
 *   D02-6  Sequential replay -> 403 SESSION_COMPROMISED, zero active family
 *          tokens, descendant refresh rejected; other families remain active.
 *   F7     Failed replay-containment persistence -> 503 retryable, never a
 *          successful compromise/revocation result; token rows unchanged.
 *   D02-7  Expired / invalid refresh JWT -> 401 (never a retryable 503);
 *          a storage failure stays 503 retryable.
 *
 *   D05-6  Body-token logout revokes the refresh session.
 *   D05-7  Unconfirmed revocation never returns 204 ->
 *          503 { error: 'LOGOUT_TEMPORARILY_UNAVAILABLE', retryable: true },
 *          refresh cookie still cleared.
 *   D05-8  Missing / unknown / already-revoked token logout is idempotent (204).
 *   D05-9  Refresh racing logout: after a successful logout, zero active tokens
 *          remain in the session family.
 *   D05-10 Logout with an older (rotated, revoked) family token revokes the
 *          active descendant.
 *   D05-11 Cookie/body credential mismatch fails before any mutation ->
 *          400 { error: 'REFRESH_TOKEN_CONFLICT' }.
 *   D05-12 Cookie-only (web) refresh never exposes the refresh token in JSON.
 *   D05-13 Body-token (mobile) refresh returns the replacement refresh token.
 *   D05-14 Login session reset racing a refresh leaves no active old-session
 *          descendant.
 *   Cookie issuance / clearing attributes are preserved.
 *
 * Real createApp() HTTP boundary, real issueAuthTokens, real disposable
 * PostgreSQL with forced RLS (all fixture reads go through withTenant as the
 * restricted runtime role). No worker, no provider call.
 *
 * DETERMINISTIC INTERLEAVING (no sleeps as proof): a coordinator connection
 * (migration role, disposable synchroflow_test_* DB only) holds a row lock
 * (SELECT ... FOR UPDATE) on the fixture refresh token. Requests that must
 * write that row park on the lock; the coordinator proves the expected number
 * of backends are blocked by it (pg_blocking_pids) — or that the request
 * already settled — before releasing. Precedent:
 * tests/integration/wms/reservation-unwind-batch-cancel-concurrency-r0v1.test.ts.
 *
 * FAULT INJECTION: a test-only BEFORE UPDATE trigger on refresh_tokens scoped
 * to the fixture shop raises, so every revocation/claim write for that shop
 * fails at the database regardless of which code path performs it. Installed
 * and dropped per test; leak-checked.
 *
 * Refresh is rate-limited per X-Forwarded-For (10/min); every request carries a
 * distinct synthetic address so the limiter never shapes an outcome.
 */

const mockResolveFault: { next: Error | null } = { next: null };
jest.mock('@lasyncro/backend-core/services/pre-tenant.service.js', () => {
  const actual = jest.requireActual('@lasyncro/backend-core/services/pre-tenant.service.js');
  return {
    ...actual,
    resolveRefreshToken: (...args: unknown[]) => {
      if (mockResolveFault.next) {
        const err = mockResolveFault.next;
        mockResolveFault.next = null;
        return Promise.reject(err);
      }
      return actual.resolveRefreshToken(...args);
    },
  };
});

import * as authAudit from 'api-src/utils/audit';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { knex as knexFactory, Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueAuthTokens, tokenPersistence, lockAuthUser } from 'api-src/api/auth/token.service';

jest.setTimeout(60000);

const app = createApp();

const REFRESH_ROUTE = '/api/v1/auth/refresh_token';
const LOGOUT_ROUTE = '/api/v1/auth/logout';
const LOGIN_ROUTE = '/api/v1/auth/login';
const PASSWORD = 'auth-session-01-synthetic-password';
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

type Fixture = { shopId: number; userId: number; email: string };
type TokenRow = { id: number; session_id: string; token_hash: string; revoked_at: Date | null };

// ── helpers ─────────────────────────────────────────────────────────────────

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `10.201.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

function refreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT secrets missing in test env');
  return secret;
}

async function createShop(label: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `auth-session-01-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedUser(label: string): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await createShop(label);
  const email = `auth-session-01-${label}-${unique}@test.example`;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email,
        password_hash: passwordHash,
        first_name: label,
        role: 'owner',
      })
      .returning('id');
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: row.id,
      role: 'owner',
      revoked_at: null,
    });
    return Number(row.id);
  });

  return { shopId, userId, email };
}

/** Canonical persisted session via the real issuance authority. */
async function mintSession(f: Fixture): Promise<{ accessToken: string; refreshToken: string }> {
  return issueAuthTokens({
    userId: f.userId,
    shopId: f.shopId,
    actorType: 'shop_user',
    authProvider: 'password',
    shopRoles: ['owner'],
    scopes: [],
    tokenVersion: 1,
  });
}

async function tokenRows(shopId: number, userId: number): Promise<TokenRow[]> {
  return withTenant(shopId, (trx) =>
    trx('refresh_tokens')
      .where({ shop_id: shopId, user_id: userId })
      .orderBy('id')
      .select('id', 'session_id', 'token_hash', 'revoked_at'),
  );
}

const activeRows = (rows: TokenRow[]) => rows.filter((r) => r.revoked_at === null);

async function rowIdFor(f: Fixture, token: string): Promise<number> {
  const row = (await tokenRows(f.shopId, f.userId)).find((r) => r.token_hash === sha256(token));
  if (!row) throw new Error('fixture token row not found');
  return row.id;
}

function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
}

function refreshCookieHeader(res: request.Response): string | undefined {
  return setCookies(res).find((c) => c.startsWith('refreshToken='));
}

/** Value of a non-empty refreshToken Set-Cookie, else null. */
function refreshCookieValue(res: request.Response): string | null {
  const header = refreshCookieHeader(res);
  if (!header) return null;
  const value = header.split(';')[0].slice('refreshToken='.length);
  return value.length > 0 ? decodeURIComponent(value) : null;
}

function refreshWithCookie(token: string) {
  return request(app)
    .post(REFRESH_ROUTE)
    .set('X-Forwarded-For', nextIp())
    .set('Cookie', `refreshToken=${token}`)
    .send({});
}

function refreshWithBody(token: string) {
  return request(app)
    .post(REFRESH_ROUTE)
    .set('X-Forwarded-For', nextIp())
    .send({ refreshToken: token });
}

function logout(opts: { cookie?: string; body?: string } = {}) {
  let req = request(app).post(LOGOUT_ROUTE).set('X-Forwarded-For', nextIp());
  if (opts.cookie !== undefined) req = req.set('Cookie', `refreshToken=${opts.cookie}`);
  return req.send(opts.body !== undefined ? { refreshToken: opts.body } : {});
}

function login(email: string) {
  return request(app)
    .post(LOGIN_ROUTE)
    .set('X-Forwarded-For', nextIp())
    .send({ email, password: PASSWORD });
}

function decodeRefresh(token: string): { session_id: string; iat: number } {
  return jwt.decode(token) as { session_id: string; iat: number };
}

// ── coordinator (migration role, disposable DB only) ────────────────────────

function assertDisposableTestDb(): string {
  const pgdb = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(pgdb)) {
    throw new Error(`AUTH-SESSION-01: refusing coordinator/DDL — PGDATABASE "${pgdb}" is not a disposable synchroflow_test_* database`);
  }
  return pgdb;
}

let coord: Knex | null = null;

function coordinator(): Knex {
  if (!coord) {
    coord = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        user: process.env.PGMIGRATION_USER,
        password: String(process.env.PGMIGRATION_PASSWORD || ''),
        database: assertDisposableTestDb(),
      },
      pool: { min: 0, max: 2 },
    });
  }
  return coord;
}

async function waitFor<T>(
  probe: () => Promise<T>,
  label: string,
  { tries = 400, intervalMs = 25 } = {},
): Promise<NonNullable<T>> {
  for (let i = 0; i < tries; i++) {
    const v = await probe();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

type Tracked = { promise: Promise<request.Response>; settled: () => boolean };

function track(req: PromiseLike<request.Response>): Tracked {
  let done = false;
  const promise = Promise.resolve(req).finally(() => {
    done = true;
  });
  return { promise, settled: () => done };
}

type RowLock = {
  pid: number;
  /** Wait until every tracked request is either blocked by this lock or settled. */
  waitParked: (tracked: Tracked[], label: string) => Promise<{ blocked: number; settled: number }>;
  release: () => Promise<void>;
};

async function lockTokenRow(shopId: number, tokenId: number): Promise<RowLock> {
  const c = coordinator();
  const trx = await c.transaction();
  let open = true;
  await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shopId)]);
  const locked = await trx.raw(`SELECT id FROM refresh_tokens WHERE id = ? FOR UPDATE`, [tokenId]);
  if (locked.rows.length !== 1) {
    await trx.rollback();
    throw new Error('coordinator could not lock fixture token row');
  }
  const pid = Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);

  // Row-lock waiters queue: only the first waiter is blocked by the holder
  // directly; later waiters are blocked by the waiter ahead of them. Count the
  // transitive blocking chain rooted at the holder.
  const blockedCount = async () => {
    const r = await c.raw(
      `WITH RECURSIVE chain(pid) AS (
         SELECT a.pid FROM pg_stat_activity a
          WHERE a.pid <> ? AND ? = ANY(pg_blocking_pids(a.pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a
           JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
          WHERE a.pid <> ?
       )
       SELECT count(DISTINCT pid)::int AS n FROM chain`,
      [pid, pid, pid],
    );
    return Number(r.rows[0].n);
  };

  return {
    pid,
    waitParked: async (tracked, label) =>
      waitFor(async () => {
        const settled = tracked.filter((t) => t.settled()).length;
        const blocked = await blockedCount();
        return blocked + settled >= tracked.length ? { blocked, settled } : null;
      }, label),
    release: async () => {
      if (open) {
        open = false;
        await trx.commit();
      }
    },
  };
}

/** Test-only fault: every UPDATE of this shop's refresh_tokens rows raises. */
async function withUpdateFault<T>(shopId: number, fn: () => Promise<T>): Promise<T> {
  assertDisposableTestDb();
  const c = coordinator();
  const uniq = crypto.randomUUID().replace(/-/g, '');
  const fnName = `auth_session_01_fault_${uniq}`;
  const trgName = `auth_session_01_fault_trg_${uniq}`;
  await c.raw(
    `CREATE FUNCTION ${fnName}() RETURNS trigger LANGUAGE plpgsql AS $$ ` +
      `BEGIN RAISE EXCEPTION 'AUTH_SESSION_01_INJECTED_UPDATE_FAULT'; END; $$;`,
  );
  await c.raw(
    `CREATE TRIGGER ${trgName} BEFORE UPDATE ON refresh_tokens FOR EACH ROW ` +
      `WHEN (OLD.shop_id = ${Number(shopId)}) EXECUTE FUNCTION ${fnName}();`,
  );
  try {
    return await fn();
  } finally {
    await c.raw(`DROP TRIGGER IF EXISTS ${trgName} ON refresh_tokens`);
    await c.raw(`DROP FUNCTION IF EXISTS ${fnName}()`);
    const residual = await c.raw(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'auth_session_01_fault%'`);
    if (residual.rows.length > 0) {
      throw new Error(`AUTH-SESSION-01 test-only trigger leaked: ${JSON.stringify(residual.rows)}`);
    }
  }
}

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (coord) await coord.destroy();
  await db.destroy();
});

// ── D02 — atomic refresh rotation ───────────────────────────────────────────

describe('AUTH-SESSION-01 D02 — atomic refresh rotation', () => {

  it('D02-P1-POOL: 20 concurrent token issuances reuse occupied transaction connections', async () => {
    const poolSize = 20;
    const fixtures: Fixture[] = [];

    for (let n = 0; n < poolSize; n += 1) {
      fixtures.push(await seedUser(`pool-${n}`));
    }

    let occupied = 0;
    let release!: () => void;
    let signalReady!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const allReady = new Promise<void>((resolve) => {
      signalReady = resolve;
    });

    const issuances = fixtures.map((f) =>
      withTenant(f.shopId, async (trx) => {
        await lockAuthUser(trx, f.shopId, f.userId);

        occupied += 1;
        if (occupied === poolSize) signalReady();

        // Every transaction holds its own connection until all 20
        // are occupied. No spare connection is available to tier lookup.
        await gate;

        return issueAuthTokens({
          userId: f.userId,
          shopId: f.shopId,
          actorType: 'shop_user',
          authProvider: 'password',
          shopRoles: ['owner'],
          scopes: [],
          tokenVersion: 1,
          transaction: trx,
        });
      }),
    );

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let readinessError: unknown;

    try {
      await Promise.race([
        allReady,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('POOL_SATURATION_BARRIER_TIMEOUT')),
            10000,
          );
        }),
      ]);

      expect(occupied).toBe(poolSize);
    } catch (error) {
      readinessError = error;
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
    }

    // Always settle transactions, including when barrier setup fails.
    const outcomes = await Promise.allSettled(issuances);

    if (readinessError) throw readinessError;

    const failures = outcomes.filter((r) => r.status === 'rejected');
    expect(failures).toEqual([]);
    expect(outcomes).toHaveLength(poolSize);

    for (let n = 0; n < poolSize; n += 1) {
      const result = outcomes[n];
      if (result.status !== 'fulfilled') {
        throw result.reason;
      }

      expect(result.value.accessToken).toBeTruthy();
      expect(result.value.refreshToken).toBeTruthy();

      const rows = await tokenRows(fixtures[n].shopId, fixtures[n].userId);
      expect(rows).toHaveLength(1);
      expect(activeRows(rows)).toHaveLength(1);
      expect(rows[0].token_hash).toBe(sha256(result.value.refreshToken));
    }
  });


  it('D02-1 F7 EXPECTED RED: concurrent refreshes rotate exactly once with zero orphan children, then replay revokes the winning child', async () => {
    const f = await seedUser('d02-concurrent');
    const { refreshToken: t0 } = await mintSession(f);
    const lock = await lockTokenRow(f.shopId, await rowIdFor(f, t0));

    let a: Tracked | null = null;
    let b: Tracked | null = null;
    let parked: { blocked: number; settled: number };
    try {
      a = track(refreshWithCookie(t0));
      b = track(refreshWithCookie(t0));
      parked = await lock.waitParked([a, b], 'both refreshes parked on the token row lock or settled');
    } finally {
      await lock.release();
    }
    const [r1, r2] = await Promise.all([a!.promise, b!.promise]);
    console.info('[AUTH-SESSION-01][D02-1] interleaving', { lockPid: lock.pid, ...parked!, statuses: [r1.status, r2.status] });

    const winners = [r1, r2].filter((r) => r.status === 200);
    const losers = [r1, r2].filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    for (const loser of losers) {
      expect(loser.status).toBe(403);
      expect(loser.body).toMatchObject({ error: 'SESSION_COMPROMISED', action: 'LOGOUT_REQUIRED' });
      expect(loser.body?.accessToken).toBeUndefined();
      expect(refreshCookieValue(loser)).toBeNull();
    }

    const winnerToken = refreshCookieValue(winners[0]);
    expect(winnerToken).toBeTruthy();

    const rows = await tokenRows(f.shopId, f.userId);
    const old = rows.find((r) => r.token_hash === sha256(t0));
    expect(old?.revoked_at).not.toBeNull();
    // Exactly the original + one child: zero orphan children.
    expect(rows).toHaveLength(2);
    const child = rows.find((r) => r.token_hash === sha256(winnerToken as string));
    expect(child).toBeDefined();
    expect(child?.session_id).toBe(decodeRefresh(t0).session_id);
    expect(activeRows(rows)).toHaveLength(0);
  });

  it('D02-2 EXPECTED RED: a transaction failure during rotation keeps the old token active, leaves no child, and is 503 retryable', async () => {
    const auditSpy = jest.spyOn(authAudit, 'audit').mockImplementation(() => { throw new Error('AUDIT_UNAVAILABLE'); });
    const f = await seedUser('d02-fault');
    const { refreshToken: t0 } = await mintSession(f);

    const res = await withUpdateFault(f.shopId, () => refreshWithCookie(t0));

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true });
    expect(res.body?.accessToken).toBeUndefined();

    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha256(t0));
    expect(rows[0].revoked_at).toBeNull();

    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ level: 'WARN', event: 'refresh_token_transient_failure',
      userId: f.userId, metadata: { sessionId: decodeRefresh(t0).session_id, reason: 'REFRESH_TEMPORARILY_UNAVAILABLE' } });
    expect(JSON.stringify(auditSpy.mock.calls)).not.toContain(t0);

    // Old token is genuinely still usable once the fault clears.
    const retry = await refreshWithCookie(t0);
    expect(retry.status).toBe(200);
  });

  it('D02-3 EXPECTED RED: a membership in a different shop never yields a child token (terminal, not retryable)', async () => {
    const f = await seedUser('d02-align');
    const { refreshToken: t0 } = await mintSession(f);
    const otherShopId = await createShop('d02-align-other');

    await withTenant(f.shopId, (trx) =>
      trx('shop_memberships')
        .where({ shop_id: f.shopId, user_id: f.userId })
        .update({ revoked_at: new Date() }),
    );
    await withTenant(otherShopId, (trx) =>
      trx('shop_memberships').insert({
        shop_id: otherShopId,
        user_id: f.userId,
        role: 'owner',
        revoked_at: null,
      }),
    );

    const res = await refreshWithCookie(t0);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'SHOP_CONTEXT_MISMATCH' });
    expect(refreshCookieValue(res)).toBeNull();

    // Tenant-scoped (RLS) proof in both shops: no child anywhere.
    const tokenShopRows = await tokenRows(f.shopId, f.userId);
    expect(tokenShopRows).toHaveLength(1);
    expect(tokenShopRows[0].token_hash).toBe(sha256(t0));
    expect(await tokenRows(otherShopId, f.userId)).toHaveLength(0);
  });

  it('D02-4 EXPECTED RED: session lineage (session_id) is stable across rotations', async () => {
    const f = await seedUser('d02-lineage');
    const { refreshToken: t0 } = await mintSession(f);

    const r1 = await refreshWithCookie(t0);
    expect(r1.status).toBe(200);
    const t1 = refreshCookieValue(r1) as string;
    const r2 = await refreshWithCookie(t1);
    expect(r2.status).toBe(200);
    const t2 = refreshCookieValue(r2) as string;

    const lineage = decodeRefresh(t0).session_id;
    expect(decodeRefresh(t1).session_id).toBe(lineage);
    expect(decodeRefresh(t2).session_id).toBe(lineage);

    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.session_id))).toEqual(new Set([lineage]));
    expect(activeRows(rows).map((r) => r.token_hash)).toEqual([sha256(t2)]);
  });

  it('D02-5 GUARD: consecutive refresh JWTs are unique even when issued within the same second', async () => {
    const f = await seedUser('d02-unique');
    const frozen = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(frozen);
    let t0: string;
    let t1: string;
    let t2: string;
    try {
      ({ refreshToken: t0 } = await mintSession(f));
      const r1 = await refreshWithCookie(t0);
      expect(r1.status).toBe(200);
      t1 = refreshCookieValue(r1) as string;
      const r2 = await refreshWithCookie(t1);
      expect(r2.status).toBe(200);
      t2 = refreshCookieValue(r2) as string;
    } finally {
      clock.mockRestore();
    }

    // Same issuance second for every token in the chain.
    expect(decodeRefresh(t1).iat).toBe(decodeRefresh(t0).iat);
    expect(decodeRefresh(t2).iat).toBe(decodeRefresh(t0).iat);

    expect(new Set([t0, t1, t2]).size).toBe(3);
    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.token_hash)).size).toBe(3);
  });

  it('D02-6 F7 EXPECTED RED: replay revokes its family, rejects the descendant and preserves another family for the same user/shop', async () => {
    const f = await seedUser('d02-replay');
    const { refreshToken: t0 } = await mintSession(f);
    const { refreshToken: otherFamilyToken } = await mintSession(f);
    const familyId = decodeRefresh(t0).session_id;
    const otherFamilyId = decodeRefresh(otherFamilyToken).session_id;
    expect(otherFamilyId).not.toBe(familyId);
    const r1 = await refreshWithCookie(t0);
    expect(r1.status).toBe(200);
    const t1 = refreshCookieValue(r1) as string;
    expect(t1).toBeTruthy();
    const before = await tokenRows(f.shopId, f.userId);
    expect(activeRows(before.filter(r => r.session_id === familyId))).toHaveLength(1);
    expect(activeRows(before.filter(r => r.session_id === otherFamilyId))).toHaveLength(1);

    const replay = await refreshWithCookie(t0);

    expect(replay.status).toBe(403);
    expect(replay.body?.error).toBe('SESSION_COMPROMISED');
    expect(replay.body?.action).toBe('LOGOUT_REQUIRED');
    expect(replay.body?.accessToken).toBeUndefined();
    expect(refreshCookieValue(replay)).toBeNull();
    const afterDetection = await tokenRows(f.shopId, f.userId);
    expect(afterDetection.length).toBe(before.length);
    const descendant = await refreshWithCookie(t1);
    const otherFamilyRefresh = await refreshWithCookie(otherFamilyToken);
    const afterAttempts = await tokenRows(f.shopId, f.userId);

    // Capture every outcome before asserting so RED evidence includes both
    // the surviving family and the descendant's actual authentication result.
    expect({
      activeCompromisedFamily: activeRows(afterDetection.filter(r => r.session_id === familyId)).length,
      otherFamilyRows: afterDetection.filter(r => r.session_id === otherFamilyId),
      descendantRejected: [401, 403].includes(descendant.status),
      descendantAccessToken: descendant.body?.accessToken,
      descendantRefreshCookie: refreshCookieValue(descendant),
      otherFamilyRefreshStatus: otherFamilyRefresh.status,
      activeCompromisedFamilyAfterAttempts: activeRows(afterAttempts.filter(r => r.session_id === familyId)).length,
      activeOtherFamilyAfterAttempts: activeRows(afterAttempts.filter(r => r.session_id === otherFamilyId)).length,
    }).toEqual({
      activeCompromisedFamily: 0,
      otherFamilyRows: before.filter(r => r.session_id === otherFamilyId),
      descendantRejected: true,
      descendantAccessToken: undefined,
      descendantRefreshCookie: null,
      otherFamilyRefreshStatus: 200,
      activeCompromisedFamilyAfterAttempts: 0,
      activeOtherFamilyAfterAttempts: 1,
    });
  });

  it('F7 EXPECTED RED: database failure during replay containment returns 503 retryable without claiming revocation or changing tokens', async () => {
    const auditSpy = jest.spyOn(authAudit, 'audit');
    const f = await seedUser('f7-containment-fault');
    const { refreshToken: t0 } = await mintSession(f);
    const rotation = await refreshWithCookie(t0);
    expect(rotation.status).toBe(200);
    const t1 = refreshCookieValue(rotation) as string;
    expect(t1).toBeTruthy();
    const before = await tokenRows(f.shopId, f.userId);
    expect(activeRows(before).map(r => r.token_hash)).toEqual([sha256(t1)]);

    const replay = await withUpdateFault(f.shopId, () => refreshWithCookie(t0));
    expect({
      status: replay.status,
      body: replay.body,
      refreshCookie: refreshCookieValue(replay),
      rows: await tokenRows(f.shopId, f.userId),
    }).toEqual({
      status: 503,
      body: { error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true },
      refreshCookie: null,
      rows: before,
    });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][0].event).toBe('refresh_token_transient_failure');
  });

  it('D02-7a EXPECTED RED: an expired refresh JWT (persisted row still valid) is 401 SESSION_EXPIRED, not 503', async () => {
    const f = await seedUser('d02-expired');
    const sessionId = crypto.randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = jwt.sign(
      { user_id: f.userId, session_id: sessionId, token_version: 1, iat: nowSeconds - SEVEN_DAYS_SECONDS - 60, exp: nowSeconds - 60 },
      refreshSecret(),
    );
    await tokenPersistence.persistRefreshToken({
      user_id: f.userId,
      shop_id: f.shopId,
      session_id: sessionId,
      token_version: 1,
      token_hash: sha256(expired),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await refreshWithCookie(expired);

    expect(res.status).toBe(401);
    expect(res.body?.error).toBe('SESSION_EXPIRED');
    expect(res.body?.retryable).not.toBe(true);
    expect(res.body?.accessToken).toBeUndefined();
    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
  });

  it('D02-7b EXPECTED RED: a refresh JWT with an invalid signature is 401, not 503', async () => {
    const f = await seedUser('d02-invalid');
    const forged = jwt.sign(
      { user_id: f.userId, session_id: crypto.randomUUID(), token_version: 1 },
      'auth-session-01-not-the-refresh-secret',
      { expiresIn: '7d' },
    );

    const res = await refreshWithCookie(forged);

    expect(res.status).toBe(401);
    expect(res.body?.retryable).not.toBe(true);
    expect(res.body?.accessToken).toBeUndefined();
    expect(await tokenRows(f.shopId, f.userId)).toHaveLength(0);
  });

  it('D02-7c GREEN CONTROL: a storage failure while resolving the token stays 503 retryable with no mutation', async () => {
    const f = await seedUser('d02-storage');
    const { refreshToken: t0 } = await mintSession(f);

    mockResolveFault.next = new Error('AUTH_SESSION_01_INJECTED_STORAGE_FAULT');
    const res = await refreshWithCookie(t0);
    mockResolveFault.next = null;

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true });
    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
  });
});

// ── D05 — logout / session revocation ───────────────────────────────────────

describe('AUTH-SESSION-01 D05 — logout and session revocation', () => {
  it('D05-6 EXPECTED RED: body-token logout (no cookie) revokes the refresh session', async () => {
    const f = await seedUser('d05-body');
    const { refreshToken: t0 } = await mintSession(f);

    const res = await logout({ body: t0 });

    expect(res.status).toBe(204);
    expect(activeRows(await tokenRows(f.shopId, f.userId))).toHaveLength(0);
  });

  it('D05-7 EXPECTED RED: unconfirmed revocation is 503 LOGOUT_TEMPORARILY_UNAVAILABLE, never 204', async () => {
    const f = await seedUser('d05-fault');
    const { refreshToken: t0 } = await mintSession(f);

    const res = await withUpdateFault(f.shopId, () => logout({ cookie: t0 }));

    expect(res.status).not.toBe(204);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'LOGOUT_TEMPORARILY_UNAVAILABLE', retryable: true });
    const cleared = refreshCookieHeader(res) ?? '';
    expect(cleared).toMatch(/^refreshToken=;/);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Strict/i);
    expect(cleared).toMatch(/Max-Age=0/i);
    const rows = await tokenRows(f.shopId, f.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).toBeNull();
  });

  it('D05-8 GREEN CONTROL: missing, unknown and already-revoked logout is idempotent 204 with preserved clear-cookie attributes', async () => {
    const missing = await logout();
    expect(missing.status).toBe(204);
    const cleared = refreshCookieHeader(missing) ?? '';
    expect(cleared).toMatch(/^refreshToken=;/);
    expect(cleared).toMatch(/HttpOnly/i);
    expect(cleared).toMatch(/SameSite=Strict/i);
    expect(cleared).toMatch(/Max-Age=0/i);

    const unknown = await logout({ cookie: 'auth-session-01-unknown-token' });
    expect(unknown.status).toBe(204);

    const f = await seedUser('d05-idempotent');
    const { refreshToken: t0 } = await mintSession(f);
    const first = await logout({ cookie: t0 });
    expect(first.status).toBe(204);
    const afterFirst = await tokenRows(f.shopId, f.userId);
    expect(activeRows(afterFirst)).toHaveLength(0);

    const second = await logout({ cookie: t0 });
    expect(second.status).toBe(204);
    expect(await tokenRows(f.shopId, f.userId)).toEqual(afterFirst);
  });

  it('D05-9 EXPECTED RED: refresh racing logout leaves zero active tokens in the session family after logout succeeds', async () => {
    const f = await seedUser('d05-race');
    const { refreshToken: t0 } = await mintSession(f);
    const lock = await lockTokenRow(f.shopId, await rowIdFor(f, t0));

    let refreshing: Tracked | null = null;
    let loggingOut: Tracked | null = null;
    let parked: { blocked: number; settled: number };
    try {
      refreshing = track(refreshWithCookie(t0));
      await lock.waitParked([refreshing], 'refresh parked on the token row lock or settled');
      loggingOut = track(logout({ cookie: t0 }));
      parked = await lock.waitParked([refreshing, loggingOut], 'refresh + logout parked on the token row lock or settled');
    } finally {
      await lock.release();
    }
    const [refreshRes, logoutRes] = await Promise.all([refreshing!.promise, loggingOut!.promise]);
    console.info('[AUTH-SESSION-01][D05-9] interleaving', {
      lockPid: lock.pid,
      ...parked!,
      refresh: refreshRes.status,
      logout: logoutRes.status,
    });

    expect(logoutRes.status).toBe(204);
    expect(activeRows(await tokenRows(f.shopId, f.userId))).toHaveLength(0);
  });

  it('D05-10 EXPECTED RED: logout with an older revoked family token revokes the active descendant', async () => {
    const f = await seedUser('d05-ancestor');
    const { refreshToken: t0 } = await mintSession(f);
    const r1 = await refreshWithCookie(t0);
    expect(r1.status).toBe(200);
    expect(activeRows(await tokenRows(f.shopId, f.userId))).toHaveLength(1);

    const res = await logout({ cookie: t0 });

    expect(res.status).toBe(204);
    expect(activeRows(await tokenRows(f.shopId, f.userId))).toHaveLength(0);
  });

  it('D05-11a EXPECTED RED: refresh with mismatched cookie/body credentials fails before mutation (no account switch)', async () => {
    const a = await seedUser('d05-mismatch-a');
    const b = await seedUser('d05-mismatch-b');
    const { refreshToken: ta } = await mintSession(a);
    const { refreshToken: tb } = await mintSession(b);

    const res = await request(app)
      .post(REFRESH_ROUTE)
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', `refreshToken=${ta}`)
      .send({ refreshToken: tb });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'REFRESH_TOKEN_CONFLICT' });
    expect(refreshCookieValue(res)).toBeNull();
    for (const f of [a, b]) {
      const rows = await tokenRows(f.shopId, f.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).toBeNull();
    }
  });

  it('D05-11b EXPECTED RED: logout with mismatched cookie/body credentials fails before mutation', async () => {
    const a = await seedUser('d05-mismatch-logout-a');
    const b = await seedUser('d05-mismatch-logout-b');
    const { refreshToken: ta } = await mintSession(a);
    const { refreshToken: tb } = await mintSession(b);

    const res = await logout({ cookie: ta, body: tb });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'REFRESH_TOKEN_CONFLICT' });
    for (const f of [a, b]) {
      const rows = await tokenRows(f.shopId, f.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].revoked_at).toBeNull();
    }
  });

  it('D05-12 GREEN CONTROL: cookie-only web refresh rotates via Set-Cookie and never exposes the refresh token in JSON', async () => {
    const auditSpy = jest.spyOn(authAudit, 'audit').mockImplementation(() => { throw new Error('AUDIT_UNAVAILABLE'); });
    const f = await seedUser('d05-web');
    const { refreshToken: t0 } = await mintSession(f);

    const res = await refreshWithCookie(t0);

    expect(res.status).toBe(200);
    expect(res.body?.accessToken).toBeTruthy();
    expect(res.body).not.toHaveProperty('refreshToken');
    const header = refreshCookieHeader(res) ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).toMatch(/Max-Age=604800/i);
    const t1 = refreshCookieValue(res) as string;
    expect(activeRows(await tokenRows(f.shopId, f.userId)).map((r) => r.token_hash)).toEqual([sha256(t1)]);
    // Current schema has no IP/UA comparison metadata: do not fabricate drift.
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('D05-13 EXPECTED RED: body-token mobile refresh returns the replacement refresh token for secure persistence', async () => {
    const f = await seedUser('d05-mobile');
    const { refreshToken: t0 } = await mintSession(f);

    const res = await refreshWithBody(t0);

    expect(res.status).toBe(200);
    expect(res.body?.accessToken).toBeTruthy();
    expect(typeof res.body?.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(t0);
    expect(activeRows(await tokenRows(f.shopId, f.userId)).map((r) => r.token_hash)).toEqual([
      sha256(res.body.refreshToken),
    ]);
  });

  it('D05-14 EXPECTED RED: login session reset racing a refresh leaves no active old-session descendant', async () => {
    const f = await seedUser('d05-login-race');
    const { refreshToken: t0 } = await mintSession(f);
    const lock = await lockTokenRow(f.shopId, await rowIdFor(f, t0));

    let loggingIn: Tracked | null = null;
    let refreshing: Tracked | null = null;
    let parked: { blocked: number; settled: number };
    try {
      loggingIn = track(login(f.email));
      await lock.waitParked([loggingIn], 'login session reset parked on the token row lock or settled');
      refreshing = track(refreshWithCookie(t0));
      parked = await lock.waitParked([loggingIn, refreshing], 'login + refresh parked on the token row lock or settled');
    } finally {
      await lock.release();
    }
    const [loginRes, refreshRes] = await Promise.all([loggingIn!.promise, refreshing!.promise]);
    console.info('[AUTH-SESSION-01][D05-14] interleaving', {
      lockPid: lock.pid,
      ...parked!,
      login: loginRes.status,
      refresh: refreshRes.status,
    });

    expect(loginRes.status).toBe(200);
    const loginRefresh = loginRes.body?.refreshToken as string;
    expect(loginRefresh).toBeTruthy();
    const active = activeRows(await tokenRows(f.shopId, f.userId));
    expect(active.map((r) => r.token_hash)).toEqual([sha256(loginRefresh)]);
  });
});
