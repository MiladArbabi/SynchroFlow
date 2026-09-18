// tests/integration/wms/carrier-settings-schema-drift-01.test.ts
//
// CARRIER-SETTINGS-SCHEMA-DRIFT-01 — permanent regression contract for the
// confirmed production schema drift on public.shop_carrier_settings.
// ===========================================================================
// CONFIRMED PRODUCTION DRIFT
//
// Historical migration 0113 (20260603141001_0113_carrier_integration.ts) was
// already applied to production in its ORIGINAL shape:
//
//   column        canonical head (post-amendment)   production (as-applied)
//   ------------  --------------------------------  -----------------------
//   public_key    text NULL                          text NOT NULL
//   private_key   text NULL                           text NOT NULL
//   api_token     text NULL                            ABSENT
//
// 0113 was later amended in source so fresh installs now receive all three
// columns nullable, including api_token. Production never received those
// amendments — it still has the pre-amendment shape above.
//
// WHY IT MATTERS: current runtime/readiness code queries api_token, which
// does not exist in production, causing:
//   GET /api/v1/onboarding/readiness -> 500
//   Postgres error: column "api_token" does not exist
//
// EXPLICITLY OUT OF SCOPE / MUST NOT CHANGE: the (shop_id, carrier_code)
// primary key, is_active, created_at, updated_at, webhook_secret (added by
// migration 0118), RLS enable + FORCE state, and
// shop_carrier_settings_tenant_isolation_policy are all CORRECT in
// production. Contract 5 below pins them.
//
// MECHANISM (precedent: tests/integration/returns/returns-schema-drift-02.test.ts)
//   The harness migrates the disposable DB to head first, so each scenario
//   opens its OWN transaction, shapes the database, invokes the located repair
//   migration against that same transaction, asserts, then ROLLS BACK.
//   PostgreSQL DDL is transactional, so the fixture is fully real inside the
//   transaction and leaves nothing behind — the backend-integration project
//   shares ONE disposable database.
//
//   The repair migration is located by STABLE SOURCE MARKER, never by number.
//
// RED CAUSE: no migration carrying CARRIER-SETTINGS-SCHEMA-DRIFT-01 exists
// yet. This file must NOT implement that forward migration and must NOT
// hard-code its future filename/number.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO, 'apps/backend/migrations');
const COMPILED_MIGRATIONS_DIR = path.join(REPO, 'apps/backend/dist/migrations');
const ISSUE_MARKER = 'CARRIER-SETTINGS-SCHEMA-DRIFT-01';

const TABLE = 'shop_carrier_settings';
const POLICY = 'shop_carrier_settings_tenant_isolation_policy';

// ---------------------------------------------------------------------------
// Repair-migration locator — stable marker, NOT a hard-coded number.
//
// A stable issue marker is a SINGLE-OWNER identifier: exactly one migration
// carries it, and that migration is this issue's repair. The locator therefore
// selects purely on marker presence, and the contract below asserts uniqueness.
// Ordering is deliberately NOT part of eligibility — timestamps are used for
// deterministic ordering only, never as a proxy for "the newest file in the
// repo". Parallel work may consume the next ordinal before this issue's repair
// is written, so the future migration filename/number is never hard-coded.
// ---------------------------------------------------------------------------
interface MigrationFile {
  file: string;
  timestamp: string;
}

function findRepairMigrations(): MigrationFile[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) =>
      fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').includes(ISSUE_MARKER),
    )
    .map((file) => ({ file, timestamp: file.split('_')[0] }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

const REPAIR_MIGRATIONS = findRepairMigrations();

interface RepairMigration {
  up(knex: Knex | Knex.Transaction): Promise<void>;
  down(knex?: Knex | Knex.Transaction): Promise<void>;
}

/**
 * The compiled build of the located repair migration — the real code.
 *
 * Throws a deterministic, self-explaining error while no repair exists. That
 * throw IS the intended RED: every scenario below depends on the repair, so
 * each one fails with the same single causal message rather than with a pile
 * of unrelated schema noise.
 */
function loadRepairMigration(): RepairMigration {
  if (REPAIR_MIGRATIONS.length !== 1) {
    throw new Error(
      `CARRIER-SETTINGS-SCHEMA-DRIFT-01: expected exactly ONE forward repair migration ` +
        `carrying the marker "${ISSUE_MARKER}", found ${REPAIR_MIGRATIONS.length} ` +
        `(${REPAIR_MIGRATIONS.map((m) => m.file).join(', ') || 'none'}). ` +
        `The forward repair migration has not been written yet.`,
    );
  }
  const compiled = REPAIR_MIGRATIONS[0].file.replace(/\.ts$/, '.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(COMPILED_MIGRATIONS_DIR, compiled)) as RepairMigration;
}

// ---------------------------------------------------------------------------
// Migration-role connection — the restricted runtime role cannot ALTER TABLE.
// ---------------------------------------------------------------------------
let db: Knex;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_/.test(name)) {
    throw new Error(
      `CARRIER-SETTINGS-SCHEMA-DRIFT-01 refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

// ---------------------------------------------------------------------------
// Structural probes — catalog-based, never "the DDL didn't throw".
// ---------------------------------------------------------------------------
interface ColumnShape {
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
}

async function columnShape(
  trx: Knex.Transaction,
  column: string,
): Promise<ColumnShape | undefined> {
  const { rows } = await trx.raw(
    `SELECT data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
    [TABLE, column],
  );
  return rows[0];
}

/** Index DEFINITIONS, not generated names — a rename must not read as a change. */
async function indexDefinitions(trx: Knex.Transaction): Promise<string[]> {
  const { rows } = await trx.raw(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ?
      ORDER BY indexdef`,
    [TABLE],
  );
  return rows.map((r: { indexdef: string }) => r.indexdef);
}

/** Constraint DEFINITIONS via pg_get_constraintdef, ordered and name-free. */
async function constraintDefinitions(trx: Knex.Transaction, contype: string): Promise<string[]> {
  const { rows } = await trx.raw(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = ? AND c.contype = ?
      ORDER BY pg_get_constraintdef(c.oid)`,
    [TABLE, contype],
  );
  return rows.map((r: { def: string }) => r.def);
}

async function rlsState(trx: Knex.Transaction) {
  const { rows } = await trx.raw(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ?`,
    [TABLE],
  );
  return rows[0] as { relrowsecurity: boolean; relforcerowsecurity: boolean };
}

/** The tenant policy's own expression, so a redefinition would be caught. */
async function policyDefinition(trx: Knex.Transaction): Promise<string | undefined> {
  const { rows } = await trx.raw(
    `SELECT qual, with_check, cmd, permissive
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ? AND policyname = ?`,
    [TABLE, POLICY],
  );
  return rows[0] ? JSON.stringify(rows[0]) : undefined;
}

/**
 * Everything contract 5 pins, captured as one comparable snapshot. Excludes
 * only the three properties this repair owns: public_key, private_key,
 * api_token.
 */
async function preservationSnapshot(trx: Knex.Transaction) {
  return {
    primaryKey: await constraintDefinitions(trx, 'p'),
    foreignKeys: await constraintDefinitions(trx, 'f'),
    indexes: await indexDefinitions(trx),
    isActive: await columnShape(trx, 'is_active'),
    createdAt: await columnShape(trx, 'created_at'),
    updatedAt: await columnShape(trx, 'updated_at'),
    webhookSecret: await columnShape(trx, 'webhook_secret'),
    rls: await rlsState(trx),
    policy: await policyDefinition(trx),
  };
}

/**
 * Shape the table into the EXACT confirmed production drift. Nothing more:
 * the primary key, is_active, created_at, updated_at, webhook_secret, RLS and
 * the policy are deliberately left alone, because production has them
 * correct.
 */
async function degradeToProductionShape(trx: Knex.Transaction): Promise<void> {
  // SET NOT NULL on public_key/private_key requires no existing NULLs.
  // Rolled back with everything else.
  await trx.raw(`DELETE FROM ${TABLE}`);

  await trx.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS api_token`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN public_key SET NOT NULL`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN private_key SET NOT NULL`);
}

/** Assert the three canonical properties this issue owns. */
async function expectCanonicalShape(trx: Knex.Transaction): Promise<void> {
  const apiToken = await columnShape(trx, 'api_token');
  expect(apiToken).toBeDefined();
  expect(apiToken!.data_type).toBe('text');
  expect(apiToken!.is_nullable).toBe('YES');

  const publicKey = await columnShape(trx, 'public_key');
  expect(publicKey).toBeDefined();
  expect(publicKey!.data_type).toBe('text');
  expect(publicKey!.is_nullable).toBe('YES');

  const privateKey = await columnShape(trx, 'private_key');
  expect(privateKey).toBeDefined();
  expect(privateKey!.data_type).toBe('text');
  expect(privateKey!.is_nullable).toBe('YES');
}

/** Run `body` in a transaction that is ALWAYS rolled back. */
async function inRolledBackTransaction(
  body: (trx: Knex.Transaction) => Promise<void>,
): Promise<void> {
  const sentinel = new Error('__rollback__');
  try {
    await db.transaction(async (trx) => {
      await body(trx);
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
}

// ---------------------------------------------------------------------------
// Minimum relational fixture: shop_carrier_settings only needs a shop row to
// reference. This issue is about column shape/data preservation, not about
// carrier workflow.
// ---------------------------------------------------------------------------
let shopId: number;

async function buildFixture(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `csd-01-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Insert a sentinel row against the fixture's tenant inside the given trx. */
async function insertSentinelRow(
  trx: Knex.Transaction,
  carrierCode: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
  await trx(TABLE).insert({
    shop_id: shopId,
    carrier_code: carrierCode,
    ...fields,
  });
}

beforeAll(async () => {
  assertDisposableDatabase();
  db = knexLib({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGMIGRATION_USER,
      password: process.env.PGMIGRATION_PASSWORD,
      database: process.env.PGDATABASE,
    },
    pool: { min: 0, max: 4 },
  });
  shopId = await buildFixture();
}, 120_000);

afterAll(async () => {
  if (db) await db.destroy();
});

// ===========================================================================
// CSD1-0 — the forward repair migration exists and is locatable
// ===========================================================================
describe('CSD1-0 — forward repair migration', () => {
  it('exactly one CARRIER-SETTINGS-SCHEMA-DRIFT-01 repair migration exists', () => {
    expect(REPAIR_MIGRATIONS.map((m) => m.file)).toHaveLength(1);
  });

  it('CONTROL: historical 0113 is not the repair and stays untouched', () => {
    const zero113 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260603141001_0113_carrier_integration.ts'),
      'utf8',
    );
    expect(zero113.includes(ISSUE_MARKER)).toBe(false);
  });

  it('CONTROL: 0118 (webhook_secret) and 0119 (webhook tokens) are separate migrations', () => {
    const zero118 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260702213201_0118_carrier_tracking_webhooks.ts'),
      'utf8',
    );
    const zero119 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260702215402_0119_carrier_webhook_tokens.ts'),
      'utf8',
    );
    expect(zero118.includes(ISSUE_MARKER)).toBe(false);
    expect(zero119.includes(ISSUE_MARKER)).toBe(false);
  });

  it('the locator throws a deterministic explanatory error while unresolved', () => {
    if (REPAIR_MIGRATIONS.length === 1) {
      // Once the repair exists this guard is inert — the throw-path contract
      // only applies while the marker count is not exactly one.
      return;
    }
    expect(() => loadRepairMigration()).toThrow(
      /CARRIER-SETTINGS-SCHEMA-DRIFT-01.*forward repair migration.*has not been written yet/s,
    );
  });
});

// ===========================================================================
// CSD1-1 — LEGACY PRODUCTION SHAPE -> CANONICAL SHAPE (+ data preservation)
// ===========================================================================
describe('CSD1-1 — the confirmed production drift is repaired to canonical', () => {
  it('degrades to the exact production shape, repairs it, and restores all three properties', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);

      // Degraded baseline — prove the fixture really is the confirmed drift.
      expect(await columnShape(trx, 'api_token')).toBeUndefined();
      expect((await columnShape(trx, 'public_key'))!.is_nullable).toBe('NO');
      expect((await columnShape(trx, 'private_key'))!.is_nullable).toBe('NO');

      await loadRepairMigration().up(trx);

      await expectCanonicalShape(trx);
    });
  }, 120_000);

  it('does not rewrite existing sendcloud-style credential values', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);

      await insertSentinelRow(trx, 'sendcloud', {
        public_key: 'sentinel-public-key-01',
        private_key: 'sentinel-private-key-01',
      });

      await loadRepairMigration().up(trx);

      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const { rows } = await trx.raw(
        `SELECT public_key, private_key, api_token FROM ${TABLE}
          WHERE shop_id = ? AND carrier_code = 'sendcloud'`,
        [shopId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].public_key).toBe('sentinel-public-key-01');
      expect(rows[0].private_key).toBe('sentinel-private-key-01');
      expect(rows[0].api_token).toBeNull();
    });
  }, 120_000);
});

// ===========================================================================
// CSD1-2 — CANONICAL FRESH-INSTALL SHAPE IS SAFE (+ data preservation)
// ===========================================================================
describe('CSD1-2 — running the repair on an already-canonical database is a no-op', () => {
  it('leaves the three properties canonical', async () => {
    await inRolledBackTransaction(async (trx) => {
      await expectCanonicalShape(trx); // canonical before — no degradation applied
      await loadRepairMigration().up(trx);
      await expectCanonicalShape(trx); // canonical after
    });
  }, 120_000);

  it('does not rewrite an existing shippo-style api_token value', async () => {
    await inRolledBackTransaction(async (trx) => {
      // No degradation — this fixture starts from the already-amended head shape.
      await insertSentinelRow(trx, 'shippo', {
        api_token: 'sentinel-api-token-01',
      });

      await loadRepairMigration().up(trx);

      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const { rows } = await trx.raw(
        `SELECT public_key, private_key, api_token FROM ${TABLE}
          WHERE shop_id = ? AND carrier_code = 'shippo'`,
        [shopId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].api_token).toBe('sentinel-api-token-01');
      expect(rows[0].public_key).toBeNull();
      expect(rows[0].private_key).toBeNull();
    });
  }, 120_000);
});

// ===========================================================================
// CSD1-3 — IDEMPOTENCY
// ===========================================================================
describe('CSD1-3 — repeated application is safe', () => {
  it('up() twice succeeds and leaves the shape unchanged', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);

      const repair = loadRepairMigration();
      await repair.up(trx);
      const afterFirst = await preservationSnapshot(trx);
      await expectCanonicalShape(trx);

      await repair.up(trx); // second invocation must not throw
      await expectCanonicalShape(trx);
      expect(await preservationSnapshot(trx)).toEqual(afterFirst);
    });
  }, 120_000);
});

// ===========================================================================
// CSD1-4 — PRESERVATION of everything production already has correct
// ===========================================================================
describe('CSD1-4 — primary key, is_active, timestamps, webhook_secret, RLS and policy are untouched', () => {
  it('the structural snapshot is identical before and after repair', async () => {
    await inRolledBackTransaction(async (trx) => {
      const before = await preservationSnapshot(trx);

      await degradeToProductionShape(trx);
      await loadRepairMigration().up(trx);

      const after = await preservationSnapshot(trx);

      // Compared by DEFINITION, not by generated constraint/index name.
      expect(after.primaryKey).toEqual(before.primaryKey);
      expect(after.foreignKeys).toEqual(before.foreignKeys);
      expect(after.indexes).toEqual(before.indexes);
      expect(after.isActive).toEqual(before.isActive);
      expect(after.createdAt).toEqual(before.createdAt);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(after.webhookSecret).toEqual(before.webhookSecret);
      expect(after.rls).toEqual(before.rls);
      expect(after.policy).toEqual(before.policy);
    });
  }, 120_000);

  it('CONTROL: RLS is enabled AND forced, and the tenant policy exists', async () => {
    await inRolledBackTransaction(async (trx) => {
      const rls = await rlsState(trx);
      expect(rls.relrowsecurity).toBe(true);
      expect(rls.relforcerowsecurity).toBe(true);
      expect(await policyDefinition(trx)).toBeDefined();

      // The (shop_id, carrier_code) composite primary key is part of what
      // must survive.
      const pk = await constraintDefinitions(trx, 'p');
      expect(pk.some((d) => /shop_id/.test(d) && /carrier_code/.test(d))).toBe(true);
    });
  }, 120_000);
});
