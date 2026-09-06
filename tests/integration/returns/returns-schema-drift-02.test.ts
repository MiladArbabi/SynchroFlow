// tests/integration/returns/returns-schema-drift-02.test.ts
//
// RETURNS-SCHEMA-DRIFT-02 — permanent regression contract for the second
// confirmed production drift on public.refund_execution_line_items.
// ===========================================================================
// CONFIRMED PRODUCTION DRIFT (distinct from RETURNS-SCHEMA-DRIFT-01, which
// covered the five missing line-level decision columns)
//
//   column                          canonical 0008            production
//   ------------------------------  ------------------------  -----------------
//   lasyncro_refund_execution_id    uuid NULL                 uuid NOT NULL
//   refunded_amount                 numeric(14,2) NULL        numeric(14,2) NOT NULL
//   created_at                      timestamptz NOT NULL      timestamptz NULL,
//                                   DEFAULT now()             no default
//   source                          varchar(50) NOT NULL      ABSENT
//                                   DEFAULT 'refund_webhook'
//
// Production currently holds ZERO rows in refund_execution_line_items, which is
// why the NOT NULL tightening was even possible there.
//
// WHY IT MATTERS: this is the scan-intake shape. `createManualReturnLine()`
// writes a line for a job that has no refund yet — lasyncro_refund_execution_id
// and refunded_amount are NULL by design, and `source` distinguishes
// 'scan_intake_manual' from 'refund_webhook'. On the production shape that
// insert cannot succeed at all.
//
// EXPLICITLY OUT OF SCOPE / MUST NOT CHANGE: existing indexes, the
// execution/revenue-unit unique constraint, foreign keys, RLS enable + FORCE
// state, and refund_execution_line_items_tenant_isolation_policy are all
// CORRECT in production. Contract 5 below pins them.
//
// MECHANISM (precedent: returns-schema-drift-01.test.ts)
//   The harness migrates the disposable DB to head first, so each scenario
//   opens its OWN transaction, shapes the database, invokes the located repair
//   migration against that same transaction, asserts, then ROLLS BACK.
//   PostgreSQL DDL is transactional, so the fixture is fully real inside the
//   transaction and leaves nothing behind — the backend-integration project
//   shares ONE disposable database.
//
//   The repair migration is located by STABLE SOURCE MARKER, never by number.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import knexLib, { Knex } from 'knex';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO, 'apps/backend/migrations');
const COMPILED_MIGRATIONS_DIR = path.join(REPO, 'apps/backend/dist/migrations');
const ISSUE_MARKER = 'RETURNS-SCHEMA-DRIFT-02';

const TABLE = 'refund_execution_line_items';
const POLICY = 'refund_execution_line_items_tenant_isolation_policy';

const now = new Date('2026-09-06T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Repair-migration locator — stable marker, NOT a hard-coded number.
//
// A stable issue marker is a SINGLE-OWNER identifier: exactly one migration
// carries it, and that migration is this issue's repair. The locator therefore
// selects purely on marker presence, and the contract below asserts uniqueness.
//
// Ordering is deliberately NOT part of eligibility. An earlier version required
// the repair to sort after every migration lacking the marker, which silently
// assumed the repair was the newest file in the repo — so the moment ANY newer
// unrelated migration landed, this locator found zero and the whole suite
// collapsed. Migration 0166 exposed that. Timestamps are used for deterministic
// ordering only.
//
// Corollary, and a real hazard: never quote ANOTHER issue's marker verbatim in
// migration source. Doing so makes that file look like the other issue's repair
// and breaks its locator. Refer to sibling repairs by number.
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
    // Deterministic order only — ordering is NEVER eligibility.
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
      `RETURNS-SCHEMA-DRIFT-02: expected exactly ONE forward repair migration carrying the ` +
        `marker "${ISSUE_MARKER}" after the current migration history, found ` +
        `${REPAIR_MIGRATIONS.length} (${REPAIR_MIGRATIONS.map((m) => m.file).join(', ') || 'none'}). ` +
        `The repair migration has not been written yet.`,
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
      `RETURNS-SCHEMA-DRIFT-02 refuses to run: PGDATABASE="${name}" is not a disposable ` +
        `synchroflow_test_* database. Run via: npm run test:integration`,
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
  numeric_precision: number | null;
  numeric_scale: number | null;
  character_maximum_length: number | null;
}

async function columnShape(
  trx: Knex.Transaction,
  column: string,
): Promise<ColumnShape | undefined> {
  const { rows } = await trx.raw(
    `SELECT data_type, udt_name, is_nullable, column_default,
            numeric_precision, numeric_scale, character_maximum_length
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

/** Everything contract 5 pins, captured as one comparable snapshot. */
async function preservationSnapshot(trx: Knex.Transaction) {
  return {
    indexes: await indexDefinitions(trx),
    unique: await constraintDefinitions(trx, 'u'),
    foreignKeys: await constraintDefinitions(trx, 'f'),
    primaryKey: await constraintDefinitions(trx, 'p'),
    rls: await rlsState(trx),
    policy: await policyDefinition(trx),
  };
}

/**
 * Shape the table into the EXACT confirmed production drift. Nothing more:
 * indexes, constraints, FKs, RLS and the policy are deliberately left alone,
 * because production has them correct.
 */
async function degradeToProductionShape(trx: Knex.Transaction): Promise<void> {
  // Production holds ZERO rows, which is what made the NOT NULL tightening
  // possible there. Reproduce that precondition inside the transaction —
  // otherwise SET NOT NULL would fail on canonical rows that legitimately hold
  // NULLs. Rolled back with everything else.
  await trx.raw(`DELETE FROM ${TABLE}`);

  await trx.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS source`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN lasyncro_refund_execution_id SET NOT NULL`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN refunded_amount SET NOT NULL`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN created_at DROP NOT NULL`);
  await trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN created_at DROP DEFAULT`);
}

/** Assert the four canonical properties this issue owns. */
async function expectCanonicalShape(trx: Knex.Transaction): Promise<void> {
  const execId = await columnShape(trx, 'lasyncro_refund_execution_id');
  expect(execId).toBeDefined();
  expect(execId!.udt_name).toBe('uuid');
  expect(execId!.is_nullable).toBe('YES');

  const amount = await columnShape(trx, 'refunded_amount');
  expect(amount).toBeDefined();
  expect(amount!.data_type).toBe('numeric');
  expect(amount!.numeric_precision).toBe(14);
  expect(amount!.numeric_scale).toBe(2);
  expect(amount!.is_nullable).toBe('YES');

  const createdAt = await columnShape(trx, 'created_at');
  expect(createdAt).toBeDefined();
  expect(createdAt!.data_type).toBe('timestamp with time zone');
  expect(createdAt!.is_nullable).toBe('NO');
  // now() / CURRENT_TIMESTAMP are equivalent defaults; accept either rendering.
  expect(createdAt!.column_default ?? '').toMatch(/now\(\)|CURRENT_TIMESTAMP/i);

  const source = await columnShape(trx, 'source');
  expect(source).toBeDefined();
  expect(source!.data_type).toBe('character varying');
  expect(source!.character_maximum_length).toBe(50);
  expect(source!.is_nullable).toBe('NO');
  expect(source!.column_default ?? '').toMatch(/'refund_webhook'/);
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
// Minimum relational fixture: refund_execution_line_items.lasyncro_revenue_unit_id
// is NOT NULL with an FK to order_revenue_units, and the tenant policy resolves
// through order_revenue_units -> orders.shop_id. Nothing else is needed — this
// issue is about column shape, not about returns workflow.
// ---------------------------------------------------------------------------
interface Fixture {
  shopId: number;
  revenueUnitId: string;
}

let fixture: Fixture;

async function buildFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `rsd-02-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const orderId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const revenueUnitId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Schema Drift 02 Product',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Schema Drift 02 Variant',
      unit_cost: 5,
    });
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: 'Schema Drift 02 Line',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      estimated_unit_cost: 5,
    });
  });

  return { shopId, revenueUnitId };
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
  fixture = await buildFixture();
}, 120_000);

afterAll(async () => {
  if (db) await db.destroy();
});

// ===========================================================================
// RSD2-0 — the forward repair migration exists and is locatable
// ===========================================================================
describe('RSD2-0 — forward repair migration', () => {
  it('exactly one RETURNS-SCHEMA-DRIFT-02 repair migration exists after current history', () => {
    expect(REPAIR_MIGRATIONS.map((m) => m.file)).toHaveLength(1);
  });

  it('CONTROL: historical 0008 is not the repair and stays untouched', () => {
    const zero8 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260212162717_0008_refund_executions_sovereign.ts'),
      'utf8',
    );
    expect(zero8.includes(ISSUE_MARKER)).toBe(false);
  });

  it('CONTROL: the RETURNS-SCHEMA-DRIFT-01 repair (0165) is a separate migration', () => {
    // -01 repaired the five decision columns. -02 is a distinct drift and must
    // not be folded into an already-shipped migration.
    const zero165 = fs.readFileSync(
      path.join(
        MIGRATIONS_DIR,
        '20260828120000_0165_repair_refund_execution_line_item_decision_columns.ts',
      ),
      'utf8',
    );
    expect(zero165.includes(ISSUE_MARKER)).toBe(false);
  });
});

// ===========================================================================
// RSD2-1 — EXACT PRODUCTION DRIFT -> CANONICAL
// ===========================================================================
describe('RSD2-1 — the confirmed production drift is repaired to canonical', () => {
  it('degrades to the exact production shape, repairs it, and restores all four properties', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);

      // Degraded baseline — prove the fixture really is the confirmed drift.
      expect((await columnShape(trx, 'source'))).toBeUndefined();
      expect((await columnShape(trx, 'lasyncro_refund_execution_id'))!.is_nullable).toBe('NO');
      expect((await columnShape(trx, 'refunded_amount'))!.is_nullable).toBe('NO');
      const degradedCreatedAt = await columnShape(trx, 'created_at');
      expect(degradedCreatedAt!.is_nullable).toBe('YES');
      expect(degradedCreatedAt!.column_default).toBeNull();

      await loadRepairMigration().up(trx);

      await expectCanonicalShape(trx);
    });
  }, 120_000);
});

// ===========================================================================
// RSD2-2 — RUNTIME INSERT SEMANTICS (the scan-intake shape)
// ===========================================================================
describe('RSD2-2 — a scan-intake line inserts correctly after repair', () => {
  it('accepts NULL execution id and amount, defaults source and created_at', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);
      await loadRepairMigration().up(trx);

      // FORCE ROW LEVEL SECURITY applies to the table owner too, so the tenant
      // must be set for the policy to resolve.
      await trx.raw(`SET LOCAL app.current_tenant = '${fixture.shopId}'`);

      const lineId = crypto.randomUUID();
      await trx.raw(
        `INSERT INTO ${TABLE}
           (lasyncro_refund_line_item_id, lasyncro_refund_execution_id,
            lasyncro_revenue_unit_id, refunded_quantity)
         VALUES (?, NULL, ?, 1)`,
        [lineId, fixture.revenueUnitId],
      );

      const { rows } = await trx.raw(
        `SELECT lasyncro_refund_execution_id, refunded_amount, source, created_at
           FROM ${TABLE} WHERE lasyncro_refund_line_item_id = ?`,
        [lineId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].lasyncro_refund_execution_id).toBeNull();
      expect(rows[0].refunded_amount).toBeNull();
      expect(rows[0].source).toBe('refund_webhook');
      expect(rows[0].created_at).not.toBeNull();
    });
  }, 120_000);
});

// ===========================================================================
// RSD2-3 — CANONICAL FRESH DB NO-OP
// ===========================================================================
describe('RSD2-3 — running the repair on an already-canonical database is a no-op', () => {
  it('leaves the four properties canonical', async () => {
    await inRolledBackTransaction(async (trx) => {
      await expectCanonicalShape(trx); // canonical before
      await loadRepairMigration().up(trx);
      await expectCanonicalShape(trx); // canonical after
    });
  }, 120_000);
});

// ===========================================================================
// RSD2-4 — IDEMPOTENCY
// ===========================================================================
describe('RSD2-4 — repeated application is safe', () => {
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
// RSD2-5 — PRESERVATION of everything production already has correct
// ===========================================================================
describe('RSD2-5 — indexes, constraints, FKs, RLS and the tenant policy are untouched', () => {
  it('the structural snapshot is identical before and after repair', async () => {
    await inRolledBackTransaction(async (trx) => {
      const before = await preservationSnapshot(trx);

      await degradeToProductionShape(trx);
      await loadRepairMigration().up(trx);

      const after = await preservationSnapshot(trx);

      // Compared by DEFINITION, not by generated constraint/index name.
      expect(after.indexes).toEqual(before.indexes);
      expect(after.unique).toEqual(before.unique);
      expect(after.foreignKeys).toEqual(before.foreignKeys);
      expect(after.primaryKey).toEqual(before.primaryKey);
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

      // The execution/revenue-unit unique constraint is part of what must survive.
      const uniques = await constraintDefinitions(trx, 'u');
      expect(
        uniques.some(
          (d) =>
            /lasyncro_refund_execution_id/.test(d) && /lasyncro_revenue_unit_id/.test(d),
        ),
      ).toBe(true);
    });
  }, 120_000);
});

// ===========================================================================
// RSD2-6 — NON-DESTRUCTIVE down()
// ===========================================================================
describe('RSD2-6 — down() is non-destructive', () => {
  it('does not revert the canonical schema', async () => {
    await inRolledBackTransaction(async (trx) => {
      const before = await preservationSnapshot(trx);

      await loadRepairMigration().down(trx);

      // The four canonical properties survive rollback: they are canonical 0008
      // structures the repair only RESTORED, not feature-owned additions it
      // introduced. Reverting them would re-create this production incident.
      await expectCanonicalShape(trx);
      expect(await preservationSnapshot(trx)).toEqual(before);
    });
  }, 120_000);
});
