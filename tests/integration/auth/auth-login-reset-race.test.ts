/**
 * AUTH-AUDIT-A1.4 — login/password-reset credential race.
 *
 * R1 RESET WINS:
 * A login must not establish a new session using credentials
 * observed before an already-committed password reset.
 *
 * Real Express HTTP, real PostgreSQL, real bcrypt and token
 * persistence. The mock changes scheduling only: it delegates
 * the real pre-tenant lookup and delays delivery of its result.
 *
 * RED-only first slice. R2-R5 are deliberately deferred until
 * this regression and its synchronization seam are reviewed.
 */

type ResolverGate = {
  email: string | null;
  entered: boolean;
  signal: (() => void) | null;
  resume: Promise<void> | null;
};

const mockLoginLookupGate: ResolverGate = {
  email: null,
  entered: false,
  signal: null,
  resume: null,
};

jest.mock(
  '@lasyncro/backend-core/services/pre-tenant.service.js',
  () => {
    const actual = jest.requireActual(
      '@lasyncro/backend-core/services/pre-tenant.service.js'
    );

    return {
      ...actual,
      resolveAuthUserByEmail: async (email: string) => {
        const realResult =
          await actual.resolveAuthUserByEmail(email);

        if (
          mockLoginLookupGate.email === email &&
          !mockLoginLookupGate.entered
        ) {
          mockLoginLookupGate.entered = true;
          mockLoginLookupGate.signal?.();

          if (!mockLoginLookupGate.resume) {
            throw new Error('AUTH_R1_MISSING_RELEASE');
          }

          await mockLoginLookupGate.resume;
        }

        return realResult;
      },
    };
  }
);

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemQuery,
  systemTransaction,
  setTenantContext,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from
  '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueAuthTokens } from
  'api-src/api/auth/token.service';

jest.setTimeout(60000);

const app = createApp();

const OLD_PASSWORD = 'auth-audit-r1-old-password';
const NEW_PASSWORD = 'auth-audit-r1-new-password';

type Fixture = {
  shopId: number;
  userId: number;
  email: string;
  resetToken: string;
};

async function seed(label: string): Promise<Fixture> {
  const unique = crypto.randomBytes(8).toString('hex');

  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(
      trx, `auth-audit-r1-${label}-${unique}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  const email = `auth-audit-r1-${label}-${unique}@test.example`;
  const hash = await bcrypt.hash(OLD_PASSWORD, 4);

  const userId = await withTenant(shopId, async trx => {
    const [user] = await trx('users')
      .insert({
        shop_id: shopId,
        email,
        password_hash: hash,
        first_name: label,
        role: 'owner',
      })
      .returning('id');

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: user.id,
      role: 'owner',
      revoked_at: null,
    });

    return Number(user.id);
  });

  const resetToken = crypto.randomBytes(32).toString('hex');

  await withTenant(shopId, trx =>
    trx('users')
      .where({ id: userId, shop_id: shopId })
      .update({
        password_reset_token: resetToken,
        password_reset_expires_at:
          new Date(Date.now() + 5 * 60 * 1000),
      })
  );

  await issueAuthTokens({
    userId,
    shopId,
    actorType: 'shop_user',
    authProvider: 'password',
    shopRoles: ['owner'],
    scopes: [],
    tokenVersion: 1,
  });

  return { shopId, userId, email, resetToken };
}

async function snapshot(f: Fixture) {
  return withTenant(f.shopId, async trx => {
    const user = await trx('users')
      .where({ id: f.userId, shop_id: f.shopId })
      .first(
        'id',
        'shop_id',
        'password_hash',
        'password_reset_token',
        'password_reset_expires_at'
      );

    const sessions = await trx('refresh_tokens')
      .where({ shop_id: f.shopId, user_id: f.userId })
      .orderBy('id')
      .select('*');

    return { user, sessions };
  });
}

function nonemptyRefreshCookie(
  response: request.Response
): boolean {
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' ? [raw] : [];

  return cookies.some(
    (cookie: string) => /^refreshToken=[^;]/.test(cookie)
  );
}

async function bounded<T>(
  promise: Promise<T>,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`AUTH_R1_BARRIER_TIMEOUT:${label}`)),
      15000
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeAll(async () => {
  const name = process.env.PGDATABASE ?? '';

  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
    !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)
  ) {
    throw new Error('AUTH_R1_NON_DISPOSABLE_DB_BLOCKED');
  }

  const identity = await systemQuery(db.raw(`
    SELECT current_database() AS database,
           current_user AS role,
           rolsuper,
           rolbypassrls
      FROM pg_roles
     WHERE rolname = current_user
  `));

  expect(identity.rows).toEqual([{
    database: name,
    role: 'sf_app',
    rolsuper: false,
    rolbypassrls: false,
  }]);

  const policies = await systemQuery(db.raw(`
    SELECT relname,
           relrowsecurity,
           relforcerowsecurity
      FROM pg_class
     WHERE relname IN (
       'users', 'shop_memberships', 'refresh_tokens'
     )
       AND relkind = 'r'
     ORDER BY relname
  `));

  expect(policies.rows).toHaveLength(3);
  expect(policies.rows.every((row: {
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }) => row.relrowsecurity && row.relforcerowsecurity))
    .toBe(true);
});

afterEach(() => {
  mockLoginLookupGate.email = null;
  mockLoginLookupGate.entered = false;
  mockLoginLookupGate.signal = null;
  mockLoginLookupGate.resume = null;
});

afterAll(async () => {
  await db.destroy();
});

describe('AUTH-AUDIT-A1.4 — login/reset race', () => {
  it('R1 RED: committed reset prevents stale-password login', async () => {
    const target = await seed('target');
    const unrelated = await seed('control');

    const unrelatedBefore = await snapshot(unrelated);

    let signalSeen!: () => void;
    let releaseLogin!: () => void;

    const seen = new Promise<void>(resolve => {
      signalSeen = resolve;
    });

    const hold = new Promise<void>(resolve => {
      releaseLogin = resolve;
    });

    mockLoginLookupGate.email = target.email;
    mockLoginLookupGate.entered = false;
    mockLoginLookupGate.signal = signalSeen;
    mockLoginLookupGate.resume = hold;

    const loginPromise = Promise.resolve(
      request(app)
        .post('/api/v1/auth/login')
        .send({
          email: target.email,
          password: OLD_PASSWORD,
        })
        .timeout({ response: 25000, deadline: 30000 })
    );

    // Avoid unhandled rejection while reset establishes ordering.
    void loginPromise.catch(() => undefined);

    let loginResponse: request.Response | undefined;
    let committedReset: Awaited<ReturnType<typeof snapshot>>
      | undefined;

    try {
      // The wrapper signals only after the real DB lookup completes.
      await bounded(seen, 'real-login-lookup');
      expect(mockLoginLookupGate.entered).toBe(true);

      const resetResponse = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: target.resetToken,
          password: NEW_PASSWORD,
        })
        .timeout({ response: 25000, deadline: 30000 });

      expect(resetResponse.status).toBe(200);

      committedReset = await snapshot(target);

      expect(committedReset.user).toBeDefined();
      expect(
        await bcrypt.compare(
          NEW_PASSWORD,
          committedReset.user.password_hash
        )
      ).toBe(true);

      expect(
        await bcrypt.compare(
          OLD_PASSWORD,
          committedReset.user.password_hash
        )
      ).toBe(false);

      expect(committedReset.user.password_reset_token).toBeNull();

      expect(
        committedReset.sessions.filter(
          row => row.revoked_at === null
        )
      ).toHaveLength(0);

      expect(await snapshot(unrelated))
        .toEqual(unrelatedBefore);

    } finally {
      // Release unconditionally; never strand an HTTP request.
      releaseLogin();
      loginResponse = await bounded(
        loginPromise, 'login-completion'
      );
    }

    const afterLogin = await snapshot(target);

    console.info('[AUTH-AUDIT-A1.4][R1]', {
      loginStatus: loginResponse.status,
      insertedSessionCount:
        afterLogin.sessions.length -
        committedReset!.sessions.length,
      activeSessionCount: afterLogin.sessions.filter(
        row => row.revoked_at === null
      ).length,
    });

    // Required security contract: expected RED on vulnerable main.
    expect(loginResponse.status).toBe(401);
    expect(loginResponse.body).toEqual({
      error: 'Invalid email or password.',
    });

    expect(loginResponse.body.accessToken).toBeUndefined();
    expect(loginResponse.body.refreshToken).toBeUndefined();
    expect(nonemptyRefreshCookie(loginResponse)).toBe(false);

    expect(afterLogin).toEqual(committedReset);

    expect(await snapshot(unrelated))
      .toEqual(unrelatedBefore);
  });
});

// ─────────────────────────────────────────────────────────────
// R2-R4 — preservation controls for F1 remediation.
// ─────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function refreshWithBody(token: string) {
  return request(app)
    .post('/api/v1/auth/refresh_token')
    .set('X-Forwarded-For', `10.209.1.${++refreshIp}`)
    .send({ refreshToken: token })
    .timeout({ response: 25000, deadline: 30000 });
}

let refreshIp = 0;

function loginWith(email: string, password: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .timeout({ response: 25000, deadline: 30000 });
}

function resetWith(token: string, password: string) {
  return request(app)
    .post('/api/v1/auth/reset-password')
    .send({ token, password })
    .timeout({ response: 25000, deadline: 30000 });
}

describe('AUTH-AUDIT-A1.4 — preservation controls', () => {
  it('R2 GREEN: login before reset is revoked', async () => {
    const target = await seed('r2-target');
    const control = await seed('r2-other-tenant');
    const controlBefore = await snapshot(control);

    const loginResponse = await loginWith(
      target.email, OLD_PASSWORD
    );

    expect(loginResponse.status).toBe(200);
    expect(typeof loginResponse.body.accessToken)
      .toBe('string');
    expect(typeof loginResponse.body.refreshToken)
      .toBe('string');

    const token = loginResponse.body.refreshToken as string;
    const hash = sha256(token);
    const afterLogin = await snapshot(target);

    const issuedRow = afterLogin.sessions.find(
      row => row.token_hash === hash
    );

    expect(issuedRow).toBeDefined();
    expect(issuedRow.revoked_at).toBeNull();
    expect(afterLogin.sessions.filter(
      row => row.revoked_at === null
    )).toHaveLength(1);

    const resetResponse = await resetWith(
      target.resetToken, NEW_PASSWORD
    );

    expect(resetResponse.status).toBe(200);

    const afterReset = await snapshot(target);
    const revokedRow = afterReset.sessions.find(
      row => row.id === issuedRow.id
    );

    expect(revokedRow).toMatchObject({
      token_hash: hash,
      revoked_at: expect.any(Date),
    });

    expect(afterReset.sessions.filter(
      row => row.revoked_at === null
    )).toHaveLength(0);

    const refreshResponse = await refreshWithBody(token);

    expect(refreshResponse.status).toBe(403);
    expect(refreshResponse.body).toMatchObject({
      error: 'SESSION_COMPROMISED',
      action: 'LOGOUT_REQUIRED',
    });

    expect(refreshResponse.body.accessToken)
      .toBeUndefined();
    expect(refreshResponse.body.refreshToken)
      .toBeUndefined();

    expect((await snapshot(target)).sessions.filter(
      row => row.revoked_at === null
    )).toHaveLength(0);

    expect(await snapshot(control)).toEqual(controlBefore);
  });

  it('R3 GREEN: new password establishes a valid session', async () => {
    const target = await seed('r3-target');
    const control = await seed('r3-other-tenant');
    const controlBefore = await snapshot(control);

    const resetResponse = await resetWith(
      target.resetToken, NEW_PASSWORD
    );

    expect(resetResponse.status).toBe(200);

    const oldLogin = await loginWith(
      target.email, OLD_PASSWORD
    );

    expect(oldLogin.status).toBe(401);
    expect(oldLogin.body).toEqual({
      error: 'Invalid email or password.',
    });
    expect(nonemptyRefreshCookie(oldLogin)).toBe(false);

    const newLogin = await loginWith(
      target.email, NEW_PASSWORD
    );

    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.id).toBe(target.userId);
    expect(newLogin.body.accessToken).toEqual(
      expect.any(String)
    );

    const token = newLogin.body.refreshToken;
    expect(typeof token).toBe('string');

    const afterLogin = await snapshot(target);

    expect(afterLogin.sessions.filter(
      row => row.revoked_at === null
    ).map(row => row.token_hash)).toEqual([
      sha256(token),
    ]);

    const refreshResponse = await refreshWithBody(token);

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.accessToken)
      .toEqual(expect.any(String));
    expect(refreshResponse.body.refreshToken)
      .toEqual(expect.any(String));
    expect(refreshResponse.body.refreshToken).not.toBe(token);

    const afterRefresh = await snapshot(target);

    expect(afterRefresh.sessions.filter(
      row => row.revoked_at === null
    ).map(row => row.token_hash)).toEqual([
      sha256(refreshResponse.body.refreshToken),
    ]);

    expect(await snapshot(control)).toEqual(controlBefore);
  });

  it('R4 GREEN: incorrect login preserves legitimate sessions', async () => {
    const target = await seed('r4-target');
    const control = await seed('r4-other-tenant');
    const controlBefore = await snapshot(control);

    const issued = await issueAuthTokens({
      userId: target.userId,
      shopId: target.shopId,
      actorType: 'shop_user',
      authProvider: 'password',
      shopRoles: ['owner'],
      scopes: [],
      tokenVersion: 1,
    });

    const before = await snapshot(target);

    const failed = await loginWith(
      target.email, 'auth-audit-incorrect-password'
    );

    expect(failed.status).toBe(401);
    expect(failed.body).toEqual({
      error: 'Invalid email or password.',
    });
    expect(failed.body.accessToken).toBeUndefined();
    expect(failed.body.refreshToken).toBeUndefined();
    expect(nonemptyRefreshCookie(failed)).toBe(false);

    // Exact persisted-state equality before the usability probe.
    expect(await snapshot(target)).toEqual(before);
    expect(await snapshot(control)).toEqual(controlBefore);

    const refreshResponse = await refreshWithBody(
      issued.refreshToken
    );

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.accessToken)
      .toEqual(expect.any(String));
    expect(refreshResponse.body.refreshToken)
      .toEqual(expect.any(String));

    expect(await snapshot(control)).toEqual(controlBefore);
  });
});

// ─────────────────────────────────────────────────────────────
// R5 — Login mutation atomicity.
// Disposable PostgreSQL fault injection; no application mocks.
// ─────────────────────────────────────────────────────────────

type R5Fault = 'revoke' | 'insert';

let r5MigrationClient: import('knex').Knex | null = null;

function r5DisposableDatabase(): string {
  const name = process.env.PGDATABASE ?? '';

  if (
    process.env.NODE_ENV !== 'test' ||
    process.env.SYNCHROFLOW_DISPOSABLE_TEST_DB !== '1' ||
    !/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)
  ) {
    throw new Error('AUTH_R5_NON_DISPOSABLE_DB_BLOCKED');
  }

  return name;
}

function r5Coordinator(): import('knex').Knex {
  const database = r5DisposableDatabase();

  if (!r5MigrationClient) {
    const { knex: knexFactory } =
      jest.requireActual('knex') as typeof import('knex');

    r5MigrationClient = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        user: process.env.PGMIGRATION_USER,
        password: process.env.PGMIGRATION_PASSWORD,
        database,
      },
      pool: { min: 0, max: 2 },
      acquireConnectionTimeout: 10000,
    });
  }

  return r5MigrationClient;
}

async function withR5Fault<T>(
  fixture: Fixture,
  kind: R5Fault,
  execute: () => Promise<T>
): Promise<T> {
  r5DisposableDatabase();

  if (
    !Number.isSafeInteger(fixture.shopId) ||
    !Number.isSafeInteger(fixture.userId)
  ) {
    throw new Error('AUTH_R5_INVALID_FIXTURE_ID');
  }

  const coordinator = r5Coordinator();
  const suffix = crypto.randomUUID().replace(/-/g, '');

  const functionName = `auth_r5_fault_fn_${suffix}`;
  const triggerName = `auth_r5_fault_tr_${suffix}`;

  const predicate = kind === 'revoke'
    ? `OLD.shop_id = ${fixture.shopId}
       AND OLD.user_id = ${fixture.userId}
       AND OLD.revoked_at IS NULL
       AND NEW.revoked_at IS NOT NULL`
    : `NEW.shop_id = ${fixture.shopId}
       AND NEW.user_id = ${fixture.userId}`;

  const operation = kind === 'revoke' ? 'UPDATE' : 'INSERT';

  try {
    await coordinator.raw(`
      CREATE FUNCTION ${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'AUTH_R5_INJECTED_${kind.toUpperCase()}_FAULT';
      END;
      $$;
    `).timeout(10000);

    await coordinator.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE ${operation} ON refresh_tokens
      FOR EACH ROW
      WHEN (${predicate})
      EXECUTE FUNCTION ${functionName}();
    `).timeout(10000);

    return await execute();
  } finally {
    try {
      await coordinator.raw(`
        DROP TRIGGER IF EXISTS ${triggerName}
        ON refresh_tokens;
      `).timeout(10000);
    } finally {
      await coordinator.raw(`
        DROP FUNCTION IF EXISTS ${functionName}();
      `).timeout(10000);
    }

    const residual = await coordinator.raw(`
      SELECT
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = ?
        ) AS trigger_exists,
        EXISTS (
          SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = ?
        ) AS function_exists
    `, [triggerName, functionName]).timeout(10000);

    expect(residual.rows).toEqual([{
      trigger_exists: false,
      function_exists: false,
    }]);
  }
}

afterAll(async () => {
  if (r5MigrationClient) {
    await r5MigrationClient.destroy();
  }
});

describe('AUTH-AUDIT-A1.4 — login rollback controls', () => {
  for (const scenario of [
    {
      kind: 'revoke' as const,
      name: 'R5 GREEN: failed login revocation rolls back',
    },
    {
      kind: 'insert' as const,
      name: 'R5 GREEN: failed token insertion restores prior sessions',
    },
  ]) {
    it(scenario.name, async () => {
      const target = await seed(`r5-${scenario.kind}`);
      const control = await seed(
        `r5-${scenario.kind}-other-tenant`
      );

      // A second genuine session permits a post-failure
      // usability check without relying on the seed token.
      const existing = await issueAuthTokens({
        userId: target.userId,
        shopId: target.shopId,
        actorType: 'shop_user',
        authProvider: 'password',
        shopRoles: ['owner'],
        scopes: [],
        tokenVersion: 1,
      });

      const before = await snapshot(target);
      const controlBefore = await snapshot(control);

      expect(before.sessions.filter(
        row => row.revoked_at === null
      )).toHaveLength(2);

      await withR5Fault(target, scenario.kind, async () => {
        const response = await loginWith(
          target.email,
          OLD_PASSWORD
        );

        expect(response.status).toBe(500);

        expect(response.body.accessToken)
          .toBeUndefined();
        expect(response.body.refreshToken)
          .toBeUndefined();

        expect(nonemptyRefreshCookie(response))
          .toBe(false);

        // Prove transaction rollback while the fault is active.
        expect(await snapshot(target)).toEqual(before);
        expect(await snapshot(control))
          .toEqual(controlBefore);
      });

      // Trigger/function cleanup completed.
      // No partial login or token insertion may survive.
      expect(await snapshot(target)).toEqual(before);
      expect(await snapshot(control)).toEqual(controlBefore);

      // The preexisting legitimate session must still work.
      const refreshResponse = await refreshWithBody(
        existing.refreshToken
      );

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.accessToken)
        .toEqual(expect.any(String));
      expect(refreshResponse.body.refreshToken)
        .toEqual(expect.any(String));

      expect(await snapshot(control))
        .toEqual(controlBefore);
    });
  }
});
