/**
 * AUTH-RESET-01 / D04 — RED slice A/B/C only.
 *
 * Real createApp HTTP requests, real token resolution and persistence, and
 * restricted-role tenant fixtures in the canonical disposable PostgreSQL DB.
 * Adapted from auth-session-01-session-lifecycle.test.ts: synthetic bootstrap,
 * explicit Supertest startup, row locks, and transitive pg_blocking_pids proof.
 *
 * The users-row holder is an application-role withTenant transaction. The
 * migration-role coordinator ONLY observes blocking/time; it never writes.
 * C replaces the fixture credential in the holder transaction with the same
 * fields as forgotPassword, then commits before T1 can mutate. No email call.
 * Polling intervals are bounded observation cadence, never race evidence.
 */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { knex as knexFactory, Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  systemQuery,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueAuthTokens } from 'api-src/api/auth/token.service';

jest.setTimeout(60000);

const app = createApp();
const RESET_ROUTE = '/api/v1/auth/reset-password';
const ORIGINAL_PASSWORD = 'auth-reset-01-original-password';
const USER_FIELDS = [
  'id', 'shop_id', 'password_hash', 'password_reset_token', 'password_reset_expires_at',
];
const WAIT_MS = 10000;
const POLL_MS = 25;

type Fixture = { shopId: number; userId: number; token: string };
type UserState = {
  id: number;
  shop_id: number;
  password_hash: string;
  password_reset_token: string | null;
  password_reset_expires_at: Date | null;
};
type SessionState = {
  id: number;
  user_id: number;
  shop_id: number;
  session_id: string;
  token_hash: string;
  token_version: number;
  expires_at: Date;
  revoked_at: Date | null;
};
type Snapshot = { user: UserState; sessions: SessionState[] };
type Tracked = { promise: Promise<request.Response>; settled: () => boolean };
type UserLock = {
  pid: number;
  waitBlocked: (requests: Tracked[], label: string) => Promise<number[]>;
  replaceCredential: (token: string, expiresAt: Date) => Promise<UserState>;
  release: () => Promise<void>;
};

function disposableDb(): string {
  const name = process.env.PGDATABASE ?? '';
  if (process.env.NODE_ENV !== 'test' ||
      process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
      !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('AUTH_RESET_01_REFUSING_NON_DISPOSABLE_DB');
  }
  return name;
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
        database: disposableDb(),
      },
      pool: { min: 0, max: 2 },
      acquireConnectionTimeout: WAIT_MS,
    });
  }
  return coord;
}

beforeAll(async () => {
  const expectedDb = disposableDb();
  const result = await systemQuery(db.raw(`
    SELECT current_database() AS database, current_user AS role,
           r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user
  `));
  expect(result.rows).toEqual([{
    database: expectedDb, role: 'sf_app', rolsuper: false, rolbypassrls: false,
  }]);
});

afterAll(async () => {
  if (coord) await coord.destroy();
  await db.destroy();
});

async function seedUser(label: string, existingShopId?: number): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = existingShopId ?? await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `auth-reset-01-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  const passwordHash = await bcrypt.hash(ORIGINAL_PASSWORD, 4);
  const userId = await withTenant(shopId, async (trx) => {
    const [user] = await trx('users').insert({
      shop_id: shopId,
      email: `auth-reset-01-${label}-${unique}@test.example`,
      password_hash: passwordHash,
      first_name: label,
      role: 'owner',
    }).returning('id');
    await trx('shop_memberships').insert({
      shop_id: shopId, user_id: user.id, role: 'owner', revoked_at: null,
    });
    return Number(user.id);
  });
  const fixture = { shopId, userId, token: crypto.randomBytes(32).toString('hex') };
  await setCredential(fixture, fixture.token, new Date(Date.now() + 60000));
  await mintSession(fixture);
  return fixture;
}

async function setCredential(f: Fixture, token: string, expiresAt: Date): Promise<void> {
  const count = await withTenant(f.shopId, (trx) => trx('users')
    .where({ id: f.userId, shop_id: f.shopId })
    .update({ password_reset_token: token, password_reset_expires_at: expiresAt }));
  expect(count).toBe(1);
}

async function mintSession(f: Fixture): Promise<void> {
  await issueAuthTokens({
    userId: f.userId, shopId: f.shopId, actorType: 'shop_user',
    authProvider: 'password', shopRoles: ['owner'], scopes: [], tokenVersion: 1,
  });
}

async function snapshot(f: Fixture): Promise<Snapshot> {
  return withTenant(f.shopId, async (trx) => {
    const user = await trx<UserState>('users')
      .where({ id: f.userId, shop_id: f.shopId }).first(USER_FIELDS);
    if (!user) throw new Error('AUTH_RESET_01_FIXTURE_USER_MISSING');
    const sessions = await trx<SessionState>('refresh_tokens')
      .where({ shop_id: f.shopId, user_id: f.userId })
      .orderBy('id').select('*');
    return { user, sessions };
  });
}

function reset(token: string, password: string) {
  return request(app).post(RESET_ROUTE).send({ token, password })
    .timeout({ response: 25000, deadline: 30000 });
}

function track(req: PromiseLike<request.Response>): Tracked {
  let done = false;
  const promise = Promise.resolve(req).finally(() => { done = true; });
  // Preserve rejection for awaiting callers without an unhandled rejection
  // while the coordinator is still proving the barrier.
  void promise.catch(() => undefined);
  return { promise, settled: () => done };
}

async function observeUntil<T>(probe: () => Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`AUTH_RESET_01_BARRIER_TIMEOUT: ${label}`);
}

async function lockUser(f: Fixture): Promise<UserLock> {
  let signalReady!: (lock: UserLock) => void;
  let failReady!: (reason: unknown) => void;
  let unlock!: () => void;
  const ready = new Promise<UserLock>((resolve, reject) => {
    signalReady = resolve;
    failReady = reject;
  });
  const gate = new Promise<void>((resolve) => { unlock = resolve; });
  const completion = withTenant(f.shopId, async (trx) => {
    await trx.raw("SET LOCAL lock_timeout = '10s'");
    await trx.raw("SET LOCAL statement_timeout = '10s'");
    const user = await trx('users').where({ id: f.userId, shop_id: f.shopId })
      .forUpdate().first('id');
    if (!user) throw new Error('AUTH_RESET_01_LOCK_USER_MISSING');
    const pid = Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    let released = false;
    signalReady({
      pid,
      waitBlocked: (requests, label) => observeUntil(async () => {
        if (requests.some((req) => req.settled())) {
          throw new Error(`AUTH_RESET_01_REQUEST_SETTLED_BEFORE_BARRIER: ${label}`);
        }
        // Later waiters can block behind the first waiter, so observe the
        // transitive chain rooted at this exact fixture's holder backend.
        const result = await coordinator().raw(`
          WITH RECURSIVE chain(pid) AS (
            SELECT a.pid FROM pg_stat_activity a
             WHERE a.datname = current_database()
               AND a.pid <> ? AND ? = ANY(pg_blocking_pids(a.pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a
              JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
             WHERE a.datname = current_database() AND a.pid <> ?
          )
          SELECT DISTINCT a.pid FROM chain c JOIN pg_stat_activity a USING (pid)
           WHERE a.usename = 'sf_app' AND a.state = 'active'
             AND a.wait_event_type = 'Lock'
             AND position('users' in lower(a.query)) > 0
             AND (lower(a.query) LIKE '%update%' OR lower(a.query) LIKE '%for update%')
        `, [pid, pid, pid]).timeout(WAIT_MS);
        const pids = result.rows.map((row: { pid: number }) => Number(row.pid));
        if (requests.some((req) => req.settled())) {
          throw new Error(`AUTH_RESET_01_REQUEST_SETTLED_DURING_BARRIER: ${label}`);
        }
        return pids.length === requests.length ? pids : null;
      }, label),
      replaceCredential: async (token, expiresAt) => {
        const rows = await trx<UserState>('users')
          .where({ id: f.userId, shop_id: f.shopId })
          .update({ password_reset_token: token, password_reset_expires_at: expiresAt })
          .returning(USER_FIELDS);
        if (rows.length !== 1) throw new Error('AUTH_RESET_01_REPLACEMENT_NOT_WRITTEN');
        return rows[0];
      },
      release: async () => {
        if (!released) { released = true; unlock(); }
        // Resolves only after COMMIT, including C's replacement credential.
        await completion;
      },
    });
    await gate;
  });
  void completion.catch(failReady);
  return ready;
}

function expectRejected(res: request.Response): void {
  expect(res.status).toBe(400);
  expect(typeof res.body.error).toBe('string');
  expect(res.body.error.length).toBeGreaterThan(0);
}

async function expectSuccessfulState(
  f: Fixture, before: Snapshot, password: string,
): Promise<Snapshot> {
  const after = await snapshot(f);
  expect(await bcrypt.compare(password, after.user.password_hash)).toBe(true);
  expect(await bcrypt.compare(ORIGINAL_PASSWORD, after.user.password_hash)).toBe(false);
  expect(after.user).toEqual({
    ...before.user,
    password_hash: after.user.password_hash,
    password_reset_token: null,
    password_reset_expires_at: null,
  });
  expect(after.sessions).toEqual(before.sessions.map((row) => ({
    ...row, revoked_at: row.revoked_at ?? expect.any(Date),
  })));
  expect(after.sessions.filter((row) => row.revoked_at === null)).toHaveLength(0);
  return after;
}

describe('AUTH-RESET-01 D04 — atomic reset-token consumption (RED A/B/C)', () => {
  it('A: concurrent same-token requests have one winner; replay rejects without side effects', async () => {
    const target = await seedUser('a-target');
    await mintSession(target); // Two independent active families must be revoked.
    const sameShop = await seedUser('a-same-shop', target.shopId);
    const otherShop = await seedUser('a-other-shop');
    const before = await snapshot(target);
    const sameBefore = await snapshot(sameShop);
    const otherBefore = await snapshot(otherShop);
    expect(before.sessions).toHaveLength(2);
    expect(before.sessions.every((row) => row.revoked_at === null)).toBe(true);
    const passwords = ['auth-reset-01-winner-a', 'auth-reset-01-winner-b'];
    const lock = await lockUser(target);
    const pending: Tracked[] = [];
    try {
      pending.push(track(reset(target.token, passwords[0])));
      pending.push(track(reset(target.token, passwords[1])));
      const blocked = await lock.waitBlocked(pending, 'A: both reset requests at users mutation lock');
      expect(blocked).toHaveLength(2);
      console.info('[AUTH-RESET-01][A] barrier', { holder: lock.pid, blocked });
    } finally {
      try { await lock.release(); }
      finally { await Promise.allSettled(pending.map((req) => req.promise)); }
    }
    const responses = await Promise.all(pending.map((req) => req.promise));
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    const winner = responses.findIndex((res) => res.status === 200);
    expectRejected(responses[1 - winner]);
    const after = await expectSuccessfulState(target, before, passwords[winner]);
    expect(await bcrypt.compare(passwords[1 - winner], after.user.password_hash)).toBe(false);
    expect(await snapshot(sameShop)).toEqual(sameBefore);
    expect(await snapshot(otherShop)).toEqual(otherBefore);
    expectRejected(await reset(target.token, 'auth-reset-01-replay-password'));
    expect(await snapshot(target)).toEqual(after);
    expect(await snapshot(sameShop)).toEqual(sameBefore);
    expect(await snapshot(otherShop)).toEqual(otherBefore);
  });

  it('B: expiry crossed during a proven database wait rejects with zero state changes', async () => {
    const target = await seedUser('b-expiry');
    const expiry = new Date(Date.now() + 15000);
    await setCredential(target, target.token, expiry);
    const before = await snapshot(target);
    expect(before.user.password_reset_expires_at).toEqual(expiry);
    const lock = await lockUser(target);
    const pending: Tracked[] = [];
    try {
      const initial = await coordinator().raw(
        'SELECT clock_timestamp() < ?::timestamptz AS valid', [expiry.toISOString()],
      ).timeout(WAIT_MS);
      expect(initial.rows[0].valid).toBe(true);
      expect(Date.now()).toBeLessThan(expiry.getTime());
      pending.push(track(reset(target.token, 'auth-reset-01-expired-password')));
      const blocked = await lock.waitBlocked(pending, 'B: reset at users mutation lock before expiry');
      expect(blocked).toHaveLength(1);
      expect(Date.now()).toBeLessThan(expiry.getTime());
      // The expiry window exceeds the normal barrier timeout, so this bounded
      // clock observation explicitly has its own deadline (20 seconds).
      const deadline = Date.now() + 20000;
      let crossed = false;
      while (Date.now() < deadline) {
        const clock = await coordinator().raw(
          'SELECT clock_timestamp() > ?::timestamptz AS expired', [expiry.toISOString()],
        ).timeout(WAIT_MS);
        if (clock.rows[0].expired && Date.now() > expiry.getTime()) { crossed = true; break; }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      expect(crossed).toBe(true);
      const stillBlocked = await lock.waitBlocked(pending, 'B: reset still blocked after persisted expiry');
      expect(stillBlocked).toHaveLength(1);
      console.info('[AUTH-RESET-01][B] expiry barrier', { holder: lock.pid, blocked: stillBlocked, crossed });
    } finally {
      try { await lock.release(); }
      finally { await Promise.allSettled(pending.map((req) => req.promise)); }
    }
    expectRejected(await pending[0].promise);
    expect(await snapshot(target)).toEqual(before);
  });

  it('C: a resolved T1 cannot consume a replacement T2 committed before T1 mutation', async () => {
    const target = await seedUser('c-replacement');
    const before = await snapshot(target);
    const t2 = crypto.randomBytes(32).toString('hex');
    const t2Expiry = new Date(Date.now() + 60000);
    const lock = await lockUser(target);
    const pending: Tracked[] = [];
    let replacement: UserState | undefined;
    try {
      pending.push(track(reset(target.token, 'auth-reset-01-stale-t1-password')));
      const blocked = await lock.waitBlocked(pending, 'C: T1 resolved and waiting at users mutation lock');
      expect(blocked).toHaveLength(1);
      // Current handler reaches this UPDATE only after the real SQL resolver
      // and expiry check. No resolver/persistence mocks or production seams.
      replacement = await lock.replaceCredential(t2, t2Expiry);
      expect(replacement).toEqual({
        ...before.user, password_reset_token: t2, password_reset_expires_at: t2Expiry,
      });
      expect(await lock.waitBlocked(pending, 'C: T1 remains blocked until T2 commits')).toHaveLength(1);
      console.info('[AUTH-RESET-01][C] replacement barrier', { holder: lock.pid, blocked });
    } finally {
      try { await lock.release(); }
      finally { await Promise.allSettled(pending.map((req) => req.promise)); }
    }
    expectRejected(await pending[0].promise);
    const replacedState = { ...before, user: replacement! };
    expect(await snapshot(target)).toEqual(replacedState);
    const password = 'auth-reset-01-current-t2-password';
    expect((await reset(t2, password)).status).toBe(200);
    await expectSuccessfulState(target, replacedState, password);
  });
});

// Preservation D–G. Everything above is the immutable original A/B/C file.
// Only these additional helpers permit fixture-scoped fault DDL, following
// AUTH-SESSION-01. The original coordinator/barrier helpers remain unchanged.

async function withRevocationFault<T>(f: Fixture, run: () => Promise<T>): Promise<T> {
  disposableDb();
  const c = coordinator();
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const functionName = `auth_reset_01_fault_${suffix}`;
  const triggerName = `auth_reset_01_fault_trigger_${suffix}`;
  try {
    await c.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'AUTH_RESET_01_INJECTED_REVOCATION_FAULT'; END; $$;`).timeout(WAIT_MS);
    await c.raw(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON refresh_tokens FOR EACH ROW
      WHEN (OLD.shop_id = ${Number(f.shopId)} AND OLD.user_id = ${Number(f.userId)}
        AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
      EXECUTE FUNCTION ${functionName}();`).timeout(WAIT_MS);
    return await run();
  } finally {
    try {
      await c.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON refresh_tokens`).timeout(WAIT_MS);
    } finally {
      await c.raw(`DROP FUNCTION IF EXISTS ${functionName}()`).timeout(WAIT_MS);
    }
    const residual = await c.raw(`SELECT
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = ?) AS trigger_exists,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ?) AS function_exists`,
    [triggerName, functionName]).timeout(WAIT_MS);
    expect(residual.rows).toEqual([{ trigger_exists: false, function_exists: false }]);
  }
}

async function holdRefreshRow(f: Fixture, rowId: number): Promise<{ pid: number; release: () => Promise<void> }> {
  let signalReady!: (value: { pid: number; release: () => Promise<void> }) => void;
  let failReady!: (reason: unknown) => void;
  let unlock!: () => void;
  const ready = new Promise<{ pid: number; release: () => Promise<void> }>((resolve, reject) => {
    signalReady = resolve;
    failReady = reject;
  });
  const gate = new Promise<void>((resolve) => { unlock = resolve; });
  const completion = withTenant(f.shopId, async (trx) => {
    await trx.raw("SET LOCAL lock_timeout = '10s'");
    await trx.raw("SET LOCAL statement_timeout = '10s'");
    const row = await trx('refresh_tokens')
      .where({ id: rowId, shop_id: f.shopId, user_id: f.userId }).forUpdate().first('id');
    if (!row) throw new Error('AUTH_RESET_01_LOCK_SESSION_MISSING');
    const pid = Number((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    signalReady({ pid, release: async () => { unlock(); await completion; } });
    await gate;
  });
  void completion.catch(failReady);
  return ready;
}

async function waitDirectlyBlocked(
  req: Tracked, blockerPid: number, table: 'users' | 'refresh_tokens', label: string,
): Promise<number> {
  return observeUntil(async () => {
    if (req.settled()) throw new Error(`AUTH_RESET_01_REQUEST_SETTLED_BEFORE_ORDERING: ${label}`);
    const result = await coordinator().raw(`SELECT a.pid FROM pg_stat_activity a
      WHERE a.datname = current_database() AND a.usename = 'sf_app'
        AND a.state = 'active' AND a.wait_event_type = 'Lock'
        AND ? = ANY(pg_blocking_pids(a.pid))
        AND position(? in lower(a.query)) > 0
        AND lower(a.query) LIKE '%update%'`, [blockerPid, table]).timeout(WAIT_MS);
    if (req.settled()) throw new Error(`AUTH_RESET_01_REQUEST_SETTLED_DURING_ORDERING: ${label}`);
    return result.rows.length === 1 ? Number(result.rows[0].pid) : null;
  }, label);
}

async function issueRefreshCredential(f: Fixture): Promise<string> {
  const tokens = await issueAuthTokens({
    userId: f.userId, shopId: f.shopId, actorType: 'shop_user',
    authProvider: 'password', shopRoles: ['owner'], scopes: [], tokenVersion: 1,
  });
  return tokens.refreshToken;
}

let preservationIp = 0;
function refresh(token: string) {
  preservationIp += 1;
  return request(app).post('/api/v1/auth/refresh_token')
    .set('X-Forwarded-For', `10.202.1.${preservationIp}`)
    .send({ refreshToken: token }).timeout({ response: 25000, deadline: 30000 });
}

describe('AUTH-RESET-01 D04 — preservation D–G', () => {
  it('D: revocation failure rolls back password, reset credential and sessions', async () => {
    const target = await seedUser('d-rollback');
    const unrelated = await seedUser('d-other-tenant');
    const before = await snapshot(target);
    const unrelatedBefore = await snapshot(unrelated);
    expect(before.sessions.every((row) => row.revoked_at === null)).toBe(true);
    await withRevocationFault(target, async () => {
      let response: request.Response | undefined;
      let requestFailure: unknown;
      try {
        response = await reset(target.token, 'auth-reset-01-rollback-password');
      } catch (error) {
        requestFailure = error;
      }
      // Inspect real rollback even if HTTP completion fails. A timeout/error is
      // rethrown below, never accepted as a passing non-success response.
      expect(await snapshot(target)).toEqual(before);
      expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
      if (requestFailure) throw requestFailure;
      expect(response).toBeDefined();
      expect(response!.status).toBeGreaterThanOrEqual(400);
      expect(response!.status).toBeLessThan(600);
    });
    expect(await snapshot(target)).toEqual(before);
    expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
  });

  it('E: refresh holds the user lock first; reset revokes the committed rotation child', async () => {
    const target = await seedUser('e-refresh-first');
    const token = await issueRefreshCredential(target);
    const unrelated = await seedUser('e-other-tenant');
    const before = await snapshot(target);
    const unrelatedBefore = await snapshot(unrelated);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const parent = before.sessions.find((row) => row.token_hash === hash);
    expect(parent).toBeDefined();
    const barrier = await holdRefreshRow(target, parent!.id);
    const pending: Tracked[] = [];
    const password = 'auth-reset-01-refresh-first-password';
    try {
      pending.push(track(refresh(token)));
      // Refresh reaches refresh_tokens only after acquiring lockAuthUser.
      const firstPid = await waitDirectlyBlocked(pending[0], barrier.pid, 'refresh_tokens',
        'E: refresh owns users lock and waits on fixture token');
      pending.push(track(reset(target.token, password)));
      const secondPid = await waitDirectlyBlocked(pending[1], firstPid, 'users',
        'E: reset waits directly behind refresh on users row');
      expect(pending.every((req) => !req.settled())).toBe(true);
      console.info('[AUTH-RESET-01][E] lock order', { holder: barrier.pid, firstPid, secondPid });
    } finally {
      try { await barrier.release(); }
      finally { await Promise.allSettled(pending.map((req) => req.promise)); }
    }
    const [refreshResponse, resetResponse] = await Promise.all(pending.map((req) => req.promise));
    expect(refreshResponse.status).toBe(200);
    expect(typeof refreshResponse.body.refreshToken).toBe('string');
    expect(resetResponse.status).toBe(200);
    const after = await snapshot(target);
    const childHash = crypto.createHash('sha256').update(refreshResponse.body.refreshToken).digest('hex');
    expect(after.sessions).toHaveLength(before.sessions.length + 1);
    const child = after.sessions.find((row) => row.token_hash === childHash);
    expect(child).toMatchObject({ user_id: target.userId, shop_id: target.shopId,
      session_id: parent!.session_id, token_version: parent!.token_version, revoked_at: expect.any(Date) });
    expect(after.sessions.filter((row) => row.revoked_at === null)).toHaveLength(0);
    for (const row of before.sessions) {
      expect(after.sessions.find((current) => current.id === row.id)).toEqual({ ...row, revoked_at: expect.any(Date) });
    }
    expect(await bcrypt.compare(password, after.user.password_hash)).toBe(true);
    expect(after.user).toEqual({ ...before.user, password_hash: after.user.password_hash,
      password_reset_token: null, password_reset_expires_at: null });
    expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
  });

  it('F: reset holds the user lock first; queued refresh cannot create a usable child', async () => {
    const target = await seedUser('f-reset-first');
    const token = await issueRefreshCredential(target);
    const sameShop = await seedUser('f-same-shop', target.shopId);
    const unrelated = await seedUser('f-other-tenant');
    const before = await snapshot(target);
    const sameBefore = await snapshot(sameShop);
    const unrelatedBefore = await snapshot(unrelated);
    const barrier = await holdRefreshRow(target, before.sessions[0].id);
    const pending: Tracked[] = [];
    const password = 'auth-reset-01-reset-first-password';
    try {
      pending.push(track(reset(target.token, password)));
      // Reset reaches revocation only after locking and updating the user.
      const firstPid = await waitDirectlyBlocked(pending[0], barrier.pid, 'refresh_tokens',
        'F: reset owns users lock and waits on fixture revocation');
      pending.push(track(refresh(token)));
      const secondPid = await waitDirectlyBlocked(pending[1], firstPid, 'users',
        'F: refresh waits directly behind reset on users row');
      expect(pending.every((req) => !req.settled())).toBe(true);
      console.info('[AUTH-RESET-01][F] lock order', { holder: barrier.pid, firstPid, secondPid });
    } finally {
      try { await barrier.release(); }
      finally { await Promise.allSettled(pending.map((req) => req.promise)); }
    }
    const [resetResponse, refreshResponse] = await Promise.all(pending.map((req) => req.promise));
    expect(resetResponse.status).toBe(200);
    expect(refreshResponse.status).toBe(403);
    expect(refreshResponse.body).toMatchObject({ error: 'SESSION_COMPROMISED', action: 'LOGOUT_REQUIRED' });
    expect(refreshResponse.body.accessToken).toBeUndefined();
    expect(refreshResponse.body.refreshToken).toBeUndefined();
    const rawCookies = refreshResponse.headers['set-cookie'];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.some((cookie: string) => /^refreshToken=[^;]/.test(cookie))).toBe(false);
    await expectSuccessfulState(target, before, password);
    expect(await snapshot(sameShop)).toEqual(sameBefore);
    expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
  });

  it('G: unknown reset token rejects without changing fixture users or sessions', async () => {
    const target = await seedUser('g-unknown');
    const unrelated = await seedUser('g-unknown-other');
    const before = await snapshot(target);
    const unrelatedBefore = await snapshot(unrelated);
    const unknown = crypto.randomBytes(32).toString('hex');
    expect(unknown).not.toBe(target.token);
    expectRejected(await reset(unknown, 'auth-reset-01-unknown-password'));
    expect(await snapshot(target)).toEqual(before);
    expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
  });

  it('G: already-expired reset token rejects without changing password, token or sessions', async () => {
    const target = await seedUser('g-expired');
    const unrelated = await seedUser('g-expired-other');
    const expiry = new Date(Date.now() - 60000);
    await setCredential(target, target.token, expiry);
    const before = await snapshot(target);
    const unrelatedBefore = await snapshot(unrelated);
    const clock = await coordinator().raw(
      'SELECT clock_timestamp() > ?::timestamptz AS expired', [expiry.toISOString()],
    ).timeout(WAIT_MS);
    expect(clock.rows[0].expired).toBe(true);
    expectRejected(await reset(target.token, 'auth-reset-01-already-expired-password'));
    expect(await snapshot(target)).toEqual(before);
    expect(await snapshot(unrelated)).toEqual(unrelatedBefore);
  });
});
