import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import pg from 'pg';
import request from 'supertest';

const { Client } = pg;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

if (!migrationUrl || !appUrl) {
  throw new Error(
    'MIGRATION_DATABASE_URL and APP_DATABASE_URL are required for live RLS tests'
  );
}

const admin = new Client({ connectionString: migrationUrl });
const appDb = new Client({ connectionString: appUrl });
let createdShopId;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

before(async () => {
  await admin.connect();
  await appDb.connect();
});

after(async () => {
  if (createdShopId) {
    await admin.query('DELETE FROM public.shops WHERE id = $1', [createdShopId]);
  }
  await admin.query(
    "DELETE FROM public.waitlist_signups WHERE source = 'ci-security-regression'"
  );
  await admin.query(
    "DELETE FROM public.pilot_applications WHERE email LIKE 'ci-security-regression+%@example.com'"
  );
  await appDb.end();
  await admin.end();
});

test('restricted role cannot read tenant tables at tenant zero', async () => {
  const identity = await appDb.query(`
    SELECT current_user, role.rolsuper, role.rolbypassrls
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  `);
  assert.deepEqual(identity.rows[0], {
    current_user: 'sf_app',
    rolsuper: false,
    rolbypassrls: false,
  });

  const tables = await admin.query(`
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

  await appDb.query('BEGIN');
  try {
    await appDb.query(
      "SELECT set_config('app.current_tenant', '0', true)"
    );

    const visible = [];
    for (const { table_name: tableName } of tables.rows) {
      const result = await appDb.query(`
        SELECT EXISTS (
          SELECT 1 FROM public.${quoteIdentifier(tableName)} LIMIT 1
        ) AS visible
      `);
      if (result.rows[0].visible) visible.push(tableName);
    }
    assert.deepEqual(visible, []);
  } finally {
    await appDb.query('ROLLBACK');
  }
});

test('pre-tenant auth functions are narrow and refresh revocation persists', async () => {
  await appDb.query('BEGIN');
  try {
    const created = await appDb.query(
      'SELECT public.create_tenant_shop($1) AS shop_id',
      ['CI security regression']
    );
    createdShopId = Number(created.rows[0].shop_id);
    assert.ok(createdShopId > 0);

    await appDb.query(
      "SELECT set_config('app.current_tenant', $1, true)",
      [String(createdShopId)]
    );

    const email = `ci-security-regression+${crypto.randomUUID()}@example.com`;
    const user = await appDb.query(
      `INSERT INTO public.users
        (shop_id, email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'ci-hash', 'CI', 'Security')
       RETURNING id`,
      [createdShopId, email]
    );
    const userId = Number(user.rows[0].id);

    await appDb.query(
      `INSERT INTO public.shop_memberships (shop_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [createdShopId, userId]
    );

    const tokenHash = crypto.createHash('sha256').update('ci-token').digest('hex');
    const sessionId = crypto.randomUUID();
    await appDb.query(
      `INSERT INTO public.refresh_tokens
        (shop_id, user_id, session_id, token_version, token_hash, expires_at)
       VALUES ($1, $2, $3, 1, $4, NOW() + interval '1 hour')`,
      [createdShopId, userId, sessionId, tokenHash]
    );

    await appDb.query('COMMIT');

    const authUser = await appDb.query(
      'SELECT public.resolve_auth_user_by_email($1) AS value',
      [email]
    );
    assert.equal(authUser.rows[0].value.id, userId);
    assert.equal(authUser.rows[0].value.shop_id, createdShopId);
    assert.equal(authUser.rows[0].value.password_hash, 'ci-hash');
    assert.equal('password_reset_token' in authUser.rows[0].value, false);
    assert.equal('email_verification_token' in authUser.rows[0].value, false);

    const token = await appDb.query(
      'SELECT public.resolve_refresh_token($1, $2::uuid, 1) AS value',
      [tokenHash, sessionId]
    );
    assert.equal(token.rows[0].value.user_id, userId);
    assert.equal(token.rows[0].value.revoked_at, null);

    const revoked = await appDb.query(
      'SELECT public.revoke_refresh_token($1) AS value',
      [tokenHash]
    );
    assert.equal(revoked.rows[0].value, true);

    const afterRevoke = await admin.query(
      'SELECT revoked_at FROM public.refresh_tokens WHERE token_hash = $1',
      [tokenHash]
    );
    assert.ok(afterRevoke.rows[0].revoked_at);
  } catch (error) {
    await appDb.query('ROLLBACK').catch(() => {});
    throw error;
  }
});

test('public waitlist and pilot endpoints persist without tenant context', async () => {
  const { createApp } = await import('../dist/bootstrap/express.js');
  const app = createApp();
  const suffix = crypto.randomUUID();

  const waitlistEmail = `ci-security-regression+${suffix}@example.com`;
  const waitlist = await request(app).post('/api/v1/waitlist').send({
    email: waitlistEmail,
    store: 'https://ci.example.com',
    source: 'ci-security-regression',
  });
  assert.equal(waitlist.status, 200);

  const pilotEmail = `ci-security-regression+${suffix}@example.com`;
  const pilot = await request(app).post('/api/v1/pilot-applications').send({
    name: 'CI Security',
    email: pilotEmail,
    company: 'CI',
    storeUrl: 'https://ci.example.com',
    country: 'SE',
    ordersPerDay: '10',
    skuCount: '100',
    fulfillment: 'Own warehouse',
    biggestIssue: 'Accuracy',
    usesStocky: 'No',
    currentTools: 'Shopify',
    openToPaidPilot: 'Yes',
    contactMethod: 'Email',
  });
  assert.equal(pilot.status, 200);

  const persisted = await admin.query(
    `SELECT
      EXISTS (SELECT 1 FROM public.waitlist_signups WHERE email = $1) AS waitlist,
      EXISTS (SELECT 1 FROM public.pilot_applications WHERE email = $2) AS pilot`,
    [waitlistEmail, pilotEmail]
  );
  assert.deepEqual(persisted.rows[0], { waitlist: true, pilot: true });
});
