// tests/integration/returns/returns-schema-drift-01.test.ts
//
// RETURNS-SCHEMA-DRIFT-01 — permanent regression contract for the confirmed
// production schema drift on refund_execution_line_items.
// ===========================================================================
// CONFIRMED DEFECT
//   Production has 20260212162717_0008_refund_executions_sovereign recorded as
//   applied, but refund_execution_line_items is MISSING five columns the
//   current canonical 0008 declares:
//     return_job_id, owner_decision, decision_notes, decision_by, decision_at
//   plus the return_job_id index and the FK
//     refund_execution_line_items.return_job_id
//       -> return_jobs.return_job_id ON DELETE CASCADE
//   The equivalent LEGACY decision fields still exist on return_jobs.
//
// ROOT CAUSE
//   0008 was amended after production had already applied it. Its own DRIFT
//   WARNING (0008:4-16) forbids amending up() again and requires a NEW forward
//   migration — precedent: 0131.
//
// TEST MECHANISM (corrected)
//   The harness migrates the disposable DB to head FIRST, so the repair
//   migration has already run by the time any test executes. Asserting the
//   repaired state directly would therefore prove nothing. Each scenario below
//   instead:
//       opens its own transaction
//     -> shapes the database for that scenario (drift / canonical)
//     -> invokes the located repair migration's up() (or down()) against that
//        same transaction
//     -> asserts
//     -> ROLLS BACK
//   PostgreSQL DDL is transactional, so the fixture is completely real inside
//   the transaction and leaves nothing behind for neighbouring suites — the
//   backend-integration project shares ONE disposable database.
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
import { listItemsAwaitingDecision } from 'api-src/services/returns/returnJobs.service';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS_DIR = path.join(REPO, 'apps/backend/migrations');
const COMPILED_MIGRATIONS_DIR = path.join(REPO, 'apps/backend/dist/migrations');
const ISSUE_MARKER = 'RETURNS-SCHEMA-DRIFT-01';

const LINE_ITEMS = 'refund_execution_line_items';
const DRIFTED_COLUMNS = [
  'return_job_id',
  'owner_decision',
  'decision_notes',
  'decision_by',
  'decision_at',
] as const;

const now = new Date('2026-09-01T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Repair-migration locator — stable marker, NOT a hard-coded number.
// "Later than current history" is self-maintaining: the repair must sort after
// every migration that does NOT carry the marker. Nothing here says 0165.
// ---------------------------------------------------------------------------
interface MigrationFile {
  file: string;
  timestamp: string;
}

function findRepairMigrations(): MigrationFile[] {
  const all: MigrationFile[] = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((file) => ({ file, timestamp: file.split('_')[0] }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const marked = all.filter((m) =>
    fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), 'utf8').includes(ISSUE_MARKER),
  );
  const latestUnmarked = all
    .filter((m) => !marked.some((k) => k.file === m.file))
    .reduce((max, m) => (m.timestamp > max ? m.timestamp : max), '');

  return marked.filter((m) => m.timestamp > latestUnmarked);
}

const REPAIR_MIGRATIONS = findRepairMigrations();

interface RepairMigration {
  up(knex: Knex | Knex.Transaction): Promise<void>;
  down(knex?: Knex | Knex.Transaction): Promise<void>;
}

/** The compiled build of the located repair migration — the real code, not a copy. */
function loadRepairMigration(): RepairMigration {
  const compiled = REPAIR_MIGRATIONS[0].file.replace(/\.ts$/, '.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(COMPILED_MIGRATIONS_DIR, compiled)) as RepairMigration;
}

// ---------------------------------------------------------------------------
// Dedicated migration-role connection. DDL and the migration itself need the
// role that owns the schema; the restricted runtime role cannot ALTER TABLE.
// ---------------------------------------------------------------------------
let db: Knex;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_/.test(name)) {
    throw new Error(
      `RETURNS-SCHEMA-DRIFT-01 refuses to run: PGDATABASE="${name}" is not a disposable ` +
        `synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

async function columnsOf(trx: Knex.Transaction, table: string) {
  const { rows } = await trx.raw(
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?`,
    [table],
  );
  return Object.fromEntries(
    rows.map((r: { column_name: string }) => [r.column_name, r]),
  ) as Record<string, { data_type: string; udt_name: string; is_nullable: string }>;
}

/** Single-column FKs on <table>.<column>, described structurally. */
async function foreignKeysOn(trx: Knex.Transaction, table: string, column: string) {
  const { rows } = await trx.raw(
    `SELECT c.conname, c.confdeltype,
            ft.relname AS referenced_table, fa.attname AS referenced_column
       FROM pg_constraint c
       JOIN pg_class t  ON t.oid = c.conrelid
       JOIN pg_class ft ON ft.oid = c.confrelid
       JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord) ON TRUE
       JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = k.attnum
       JOIN unnest(c.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
       JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.attnum
      WHERE c.contype = 'f' AND t.relname = ? AND a.attname = ?
        AND array_length(c.conkey, 1) = 1`,
    [table, column],
  );
  return rows as Array<{
    conname: string;
    confdeltype: string;
    referenced_table: string;
    referenced_column: string;
  }>;
}

/** Indexes whose key is exactly (<column>). */
async function indexesOn(trx: Knex.Transaction, table: string, column: string) {
  const { rows } = await trx.raw(
    `SELECT i.relname AS index_name
       FROM pg_index x
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(x.indkey)
      WHERE t.relname = ? AND a.attname = ? AND x.indnatts = 1`,
    [table, column],
  );
  return rows as Array<{ index_name: string }>;
}

/** Degrade to the EXACT confirmed production shape. No invented extra drift. */
async function degradeToProductionShape(trx: Knex.Transaction): Promise<void> {
  for (const fk of await foreignKeysOn(trx, LINE_ITEMS, 'return_job_id')) {
    await trx.raw(`ALTER TABLE ${LINE_ITEMS} DROP CONSTRAINT "${fk.conname}"`);
  }
  for (const idx of await indexesOn(trx, LINE_ITEMS, 'return_job_id')) {
    await trx.raw(`DROP INDEX IF EXISTS "${idx.index_name}"`);
  }
  for (const c of DRIFTED_COLUMNS) {
    await trx.raw(`ALTER TABLE ${LINE_ITEMS} DROP COLUMN IF EXISTS "${c}"`);
  }
}

/**
 * Run `body` inside a transaction that is ALWAYS rolled back, so the shared
 * disposable database is byte-identical afterwards.
 */
async function inRolledBackTransaction(
  body: (trx: Knex.Transaction) => Promise<void>,
): Promise<void> {
  const sentinel = new Error('__rollback__');
  try {
    await db.transaction(async (trx) => {
      await body(trx);
      throw sentinel; // force ROLLBACK
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
}

// ---------------------------------------------------------------------------
// Fixture — a real relational chain, seeded once and committed to its own shop.
// Committed rows are safe (tenant-scoped, like the neighbouring Returns suite);
// only the DDL is transactional.
// ---------------------------------------------------------------------------
interface Fixture {
  shopId: number;
  /** Line whose refund execution maps to exactly ONE return job. */
  deterministicLineId: string;
  deterministicJobId: string;
  /** Line whose refund execution maps to NO return job. */
  unmatchedLineId: string;
  /** Line whose job carries populated LEGACY decision fields. */
  legacyDecisionLineId: string;
  legacyDecisionJobId: string;
  /** Line already linked, with line-level decision data already populated. */
  preLinkedLineId: string;
  preLinkedJobId: string;
}

let fixture: Fixture;

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

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
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });
  });

  return orderId;
}

async function seedRevenueUnit(shopId: number, orderId: string): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const revenueUnitId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Schema Drift Product',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Schema Drift Variant',
      unit_cost: 5,
    });
    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: 'Schema Drift Line',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      estimated_unit_cost: 5,
    });
  });

  return revenueUnitId;
}

async function seedRefundExecution(shopId: number, orderId: string): Promise<string> {
  const refundExecutionId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('refund_executions').insert({
      lasyncro_refund_execution_id: refundExecutionId,
      lasyncro_order_id: orderId,
      platform: 'shopify',
      external_refund_id: `rsd-${crypto.randomBytes(6).toString('hex')}`,
      total_refund_amount: '100.00',
      executed_at: now,
      created_at: now,
      updated_at: now,
    }),
  );
  return refundExecutionId;
}

async function seedReturnJob(input: {
  shopId: number;
  orderId: string;
  refundExecutionId: string | null;
  legacyDecision?: boolean;
}): Promise<string> {
  return withTenant(input.shopId, async (trx) => {
    const [row] = await trx('return_jobs')
      .insert({
        shop_id: input.shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: input.refundExecutionId,
        lasyncro_order_id: input.orderId,
        status: 'awaiting_decision',
        source: 'system_auto',
        // LEGACY job-level decision fields — the anti-backfill probe.
        owner_decision: input.legacyDecision ? 'write_off' : null,
        decision_notes: input.legacyDecision ? 'LEGACY job-level note' : null,
        decision_by: input.legacyDecision ? 4242 : null,
        decision_at: input.legacyDecision ? now : null,
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');
    return (row.return_job_id ?? row) as string;
  });
}

async function seedLine(input: {
  shopId: number;
  revenueUnitId: string;
  refundExecutionId: string | null;
  returnJobId?: string | null;
  lineLevelDecision?: boolean;
}): Promise<string> {
  const lineItemId = crypto.randomUUID();
  await withTenant(input.shopId, (trx) =>
    trx(LINE_ITEMS).insert({
      lasyncro_refund_line_item_id: lineItemId,
      lasyncro_refund_execution_id: input.refundExecutionId,
      lasyncro_revenue_unit_id: input.revenueUnitId,
      return_job_id: input.returnJobId ?? null,
      refunded_quantity: 1,
      item_condition: 'damaged',
      quantity_received: 1,
      condition_notes: 'Schema drift fixture line',
      owner_decision: input.lineLevelDecision ? 'reship' : null,
      decision_notes: input.lineLevelDecision ? 'LINE-level decision' : null,
      decision_by: input.lineLevelDecision ? 99 : null,
      decision_at: input.lineLevelDecision ? now : null,
      processed_at: now,
      source: input.refundExecutionId ? 'refund_webhook' : 'scan_intake_manual',
      created_at: now,
    }),
  );
  return lineItemId;
}

async function buildFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `rsd-01-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const orderId = await seedOrder(shopId);

  // 1. DETERMINISTIC MATCH — one line, one job, one shared refund execution.
  const detRefund = await seedRefundExecution(shopId, orderId);
  const deterministicJobId = await seedReturnJob({
    shopId,
    orderId,
    refundExecutionId: detRefund,
  });
  const deterministicLineId = await seedLine({
    shopId,
    revenueUnitId: await seedRevenueUnit(shopId, orderId),
    refundExecutionId: detRefund,
    returnJobId: null,
  });

  // 2. UNMATCHED — a refund execution with NO return job at all.
  const orphanRefund = await seedRefundExecution(shopId, orderId);
  const unmatchedLineId = await seedLine({
    shopId,
    revenueUnitId: await seedRevenueUnit(shopId, orderId),
    refundExecutionId: orphanRefund,
    returnJobId: null,
  });

  // 4. OWNER-DECISION ANTI-BACKFILL — job carries LEGACY decision values.
  const legacyRefund = await seedRefundExecution(shopId, orderId);
  const legacyDecisionJobId = await seedReturnJob({
    shopId,
    orderId,
    refundExecutionId: legacyRefund,
    legacyDecision: true,
  });
  const legacyDecisionLineId = await seedLine({
    shopId,
    revenueUnitId: await seedRevenueUnit(shopId, orderId),
    refundExecutionId: legacyRefund,
    returnJobId: null,
  });

  // 3. PRE-EXISTING LINK + line-level decision data (canonical/down scenarios).
  const preLinkedJobId = await seedReturnJob({
    shopId,
    orderId,
    refundExecutionId: null,
  });
  const preLinkedLineId = await seedLine({
    shopId,
    revenueUnitId: await seedRevenueUnit(shopId, orderId),
    refundExecutionId: null,
    returnJobId: preLinkedJobId,
    lineLevelDecision: true,
  });

  return {
    shopId,
    deterministicLineId,
    deterministicJobId,
    unmatchedLineId,
    legacyDecisionLineId,
    legacyDecisionJobId,
    preLinkedLineId,
    preLinkedJobId,
  };
}

async function lineRow(trx: Knex.Transaction, id: string) {
  const { rows } = await trx.raw(
    `SELECT * FROM ${LINE_ITEMS} WHERE lasyncro_refund_line_item_id = ?`,
    [id],
  );
  return rows[0];
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
// RSD-1 — the repair migration exists and is locatable by stable marker
// ===========================================================================
describe('RSD-1 — forward repair migration', () => {
  it('exactly one RETURNS-SCHEMA-DRIFT-01 repair migration exists after current history', () => {
    expect(REPAIR_MIGRATIONS.map((m) => m.file)).toHaveLength(1);
  });

  it('historical migration 0008 is NOT the repair and stays untouched', () => {
    const zero8 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20260212162717_0008_refund_executions_sovereign.ts'),
      'utf8',
    );
    expect(zero8.includes(ISSUE_MARKER)).toBe(false);
  });

  it('the repair migration fails closed on ambiguity — it never guesses', () => {
    // Structural guard on the source: the fail-closed branch must throw, and
    // must not degrade into a heuristic. See RSD-6 for why this cannot be
    // exercised as live data.
    const src = fs.readFileSync(
      path.join(MIGRATIONS_DIR, REPAIR_MIGRATIONS[0].file),
      'utf8',
    );
    expect(/HAVING count\(\*\) > 1/.test(src)).toBe(true);
    expect(/throw new Error\([\s\S]*AMBIGUOUS BACKFILL/.test(src)).toBe(true);

    // Heuristic selection must not appear in CODE. Comment lines are stripped
    // first — the migration legitimately documents that it uses no `LIMIT 1`,
    // and a prose mention of the anti-pattern is not the anti-pattern.
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(/LIMIT 1/i.test(code)).toBe(false);
  });
});

// ===========================================================================
// RSD-2 — PRODUCTION-DRIFT SCENARIO: degrade -> run up() -> assert -> rollback
// ===========================================================================
describe('RSD-2 — production drift is repaired by the forward migration', () => {
  it('degrades to the confirmed production shape, repairs it, and restores canonical schema', async () => {
    await inRolledBackTransaction(async (trx) => {
      // --- degraded baseline -------------------------------------------------
      await degradeToProductionShape(trx);
      const degraded = await columnsOf(trx, LINE_ITEMS);
      for (const c of DRIFTED_COLUMNS) expect(degraded[c]).toBeUndefined();
      // Nothing else was removed — this is the observed drift, not invented drift.
      for (const kept of [
        'lasyncro_refund_line_item_id',
        'lasyncro_refund_execution_id',
        'lasyncro_revenue_unit_id',
        'refunded_quantity',
        'item_condition',
        'condition_notes',
        'source',
      ]) {
        expect(degraded[kept]).toBeDefined();
      }
      expect(await foreignKeysOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(0);
      expect(await indexesOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(0);

      // return_jobs and its LEGACY decision columns survive the drift.
      const jobCols = await columnsOf(trx, 'return_jobs');
      for (const legacy of ['owner_decision', 'decision_notes', 'decision_by', 'decision_at']) {
        expect(jobCols[legacy]).toBeDefined();
      }

      // The original incident: the read path cannot execute in this shape.
      await trx.raw('SAVEPOINT probe');
      await expect(
        trx.raw(
          `SELECT reli.return_job_id, reli.owner_decision, reli.decision_notes, reli.decision_at
             FROM ${LINE_ITEMS} reli LIMIT 1`,
        ),
      ).rejects.toThrow(/column .* does not exist/i);
      await trx.raw('ROLLBACK TO SAVEPOINT probe');

      // --- run the REAL repair migration against the degraded shape ---------
      await loadRepairMigration().up(trx);

      // --- repaired schema --------------------------------------------------
      const cols = await columnsOf(trx, LINE_ITEMS);
      expect(cols['return_job_id']).toMatchObject({ udt_name: 'uuid', is_nullable: 'YES' });
      expect(cols['owner_decision']).toMatchObject({
        udt_name: 'return_owner_decision_type',
        is_nullable: 'YES',
      });
      expect(cols['decision_notes']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
      expect(cols['decision_by']).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
      expect(cols['decision_at']).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
      });

      const fks = await foreignKeysOn(trx, LINE_ITEMS, 'return_job_id');
      expect(fks).toHaveLength(1);
      expect(fks[0]).toMatchObject({
        referenced_table: 'return_jobs',
        referenced_column: 'return_job_id',
        confdeltype: 'c', // ON DELETE CASCADE
      });
      expect(await indexesOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(1);
    });
  }, 120_000);

  it('DATA: deterministic match backfills, unmatched stays NULL, legacy decisions are not copied', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);
      await loadRepairMigration().up(trx);

      // 1. DETERMINISTIC MATCH — linked to the exact matching job.
      const det = await lineRow(trx, fixture.deterministicLineId);
      expect(det.return_job_id).toBe(fixture.deterministicJobId);

      // 2. UNMATCHED — refund execution with no return job stays NULL.
      const unmatched = await lineRow(trx, fixture.unmatchedLineId);
      expect(unmatched.return_job_id).toBeNull();

      // 4. OWNER-DECISION ANTI-BACKFILL — the job's LEGACY decision values are
      //    populated, yet the line-level columns must remain NULL. Job-level is
      //    a per-job summary; line-level is a per-unit disposition. Copying
      //    would fabricate dispositions no operator ever made.
      const legacyLine = await lineRow(trx, fixture.legacyDecisionLineId);
      expect(legacyLine.return_job_id).toBe(fixture.legacyDecisionJobId);
      expect(legacyLine.owner_decision).toBeNull();
      expect(legacyLine.decision_notes).toBeNull();
      expect(legacyLine.decision_by).toBeNull();
      expect(legacyLine.decision_at).toBeNull();

      // Control: the legacy job-level values really are populated, so the
      // assertion above is meaningful rather than vacuous.
      const { rows: jobRows } = await trx.raw(
        `SELECT owner_decision, decision_notes, decision_by, decision_at
           FROM return_jobs WHERE return_job_id = ?`,
        [fixture.legacyDecisionJobId],
      );
      expect(jobRows[0].owner_decision).toBe('write_off');
      expect(jobRows[0].decision_notes).toBe('LEGACY job-level note');
      expect(jobRows[0].decision_by).toBe(4242);
      expect(jobRows[0].decision_at).not.toBeNull();
    });
  }, 120_000);

  it('ORIGINAL INCIDENT: the listItemsAwaitingDecision column set executes after repair', async () => {
    await inRolledBackTransaction(async (trx) => {
      await degradeToProductionShape(trx);
      await loadRepairMigration().up(trx);

      // The exact join + column set from returnJobs.service.ts:946
      // listItemsAwaitingDecision — the query that could not run on the drift.
      await expect(
        trx.raw(
          `SELECT rj.return_job_id,
                  eoim.external_order_id,
                  reli.lasyncro_refund_line_item_id AS line_id,
                  reli.quantity_received,
                  reli.item_condition,
                  reli.condition_notes,
                  reli.owner_decision,
                  reli.decision_notes,
                  reli.decision_at
             FROM return_jobs rj
             JOIN external_order_identity_map eoim
               ON eoim.lasyncro_order_id = rj.lasyncro_order_id
             JOIN ${LINE_ITEMS} reli ON reli.return_job_id = rj.return_job_id
             JOIN order_revenue_units oru
               ON oru.lasyncro_revenue_unit_id = reli.lasyncro_revenue_unit_id
            WHERE rj.shop_id = ?
              AND rj.status = 'awaiting_decision'`,
          [fixture.shopId],
        ),
      ).resolves.toBeDefined();
    });
  }, 120_000);
});

// ===========================================================================
// RSD-3 — FRESH / CANONICAL SCENARIO (clean state, NOT inside the drift tx)
// ===========================================================================
describe('RSD-3 — re-running the repair on an already-canonical database is safe', () => {
  it('succeeds with no duplicate column, FK, or index, and leaves data unchanged', async () => {
    await inRolledBackTransaction(async (trx) => {
      const before = await lineRow(trx, fixture.preLinkedLineId);
      const beforeCount = (await trx.raw(`SELECT count(*)::int AS n FROM ${LINE_ITEMS}`))
        .rows[0].n;

      // No degradation — this is the fresh-install shape 0008 already provides.
      await loadRepairMigration().up(trx);

      for (const c of DRIFTED_COLUMNS) {
        const { rows } = await trx.raw(
          `SELECT count(*)::int AS n FROM information_schema.columns
            WHERE table_schema='public' AND table_name=? AND column_name=?`,
          [LINE_ITEMS, c],
        );
        expect(rows[0].n).toBe(1);
      }
      expect(await foreignKeysOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(1);
      expect(await indexesOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(1);

      // 3. PRE-EXISTING LINK preserved exactly, and no row was added or lost.
      const after = await lineRow(trx, fixture.preLinkedLineId);
      expect(after.return_job_id).toBe(fixture.preLinkedJobId);
      expect(after.return_job_id).toBe(before.return_job_id);
      expect(after.owner_decision).toBe('reship');
      expect(after.decision_notes).toBe('LINE-level decision');
      const afterCount = (await trx.raw(`SELECT count(*)::int AS n FROM ${LINE_ITEMS}`))
        .rows[0].n;
      expect(afterCount).toBe(beforeCount);
    });
  }, 120_000);
});

// ===========================================================================
// RSD-4 — NON-DESTRUCTIVE down(), run against the canonical/repaired shape
// ===========================================================================
describe('RSD-4 — down() is non-destructive', () => {
  it('keeps the five columns, the FK, the index, and all line-level data', async () => {
    await inRolledBackTransaction(async (trx) => {
      const before = await lineRow(trx, fixture.preLinkedLineId);
      const beforeCount = (await trx.raw(`SELECT count(*)::int AS n FROM ${LINE_ITEMS}`))
        .rows[0].n;

      await loadRepairMigration().down(trx);

      const cols = await columnsOf(trx, LINE_ITEMS);
      for (const c of DRIFTED_COLUMNS) expect(cols[c]).toBeDefined();

      expect(await foreignKeysOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(1);
      expect(await indexesOn(trx, LINE_ITEMS, 'return_job_id')).toHaveLength(1);

      const after = await lineRow(trx, fixture.preLinkedLineId);
      expect(after.return_job_id).toBe(before.return_job_id); // link data survives
      expect(after.owner_decision).toBe('reship');            // line-level decision survives
      expect(after.decision_notes).toBe('LINE-level decision');
      expect((await trx.raw(`SELECT count(*)::int AS n FROM ${LINE_ITEMS}`)).rows[0].n)
        .toBe(beforeCount);
    });
  }, 120_000);
});

// ===========================================================================
// RSD-5 — the real read path, end to end, on the committed canonical database
// ===========================================================================
describe('RSD-5 — the real listItemsAwaitingDecision executes on the repaired schema', () => {
  it('the production service function runs and returns its decision groups', async () => {
    // Not a hand-written query: the actual exported service function, against
    // the committed database the harness migrated (0165 included).
    const groups = await listItemsAwaitingDecision(fixture.shopId);
    expect(Array.isArray(groups)).toBe(true);
  }, 60_000);
});

// ===========================================================================
// RSD-6 — AMBIGUITY: why it cannot be constructed, and what actually prevents it
// ===========================================================================
describe('RSD-6 — ambiguity is structurally unreachable in the canonical schema', () => {
  it('return_jobs.lasyncro_refund_execution_id carries a UNIQUE constraint', async () => {
    // 0008:317 declares
    //   table.unique(['lasyncro_refund_execution_id'], 'return_jobs_refund_execution_unique')
    // so a refund execution can NEVER map to more than one return job. The
    // migration's fail-closed branch is therefore correct AND unreachable while
    // this constraint stands — it guards against the constraint being dropped
    // later, which is exactly why it must stay in the migration.
    //
    // This fixture deliberately does NOT drop that constraint to manufacture
    // ambiguity: doing so would test a state the canonical schema forbids, and
    // would mean weakening a canonical structure to satisfy a test.
    await inRolledBackTransaction(async (trx) => {
      const { rows } = await trx.raw(
        `SELECT c.conname, c.contype
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE t.relname = 'return_jobs'
            AND a.attname = 'lasyncro_refund_execution_id'
            AND c.contype = 'u'
            AND array_length(c.conkey, 1) = 1`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].conname).toBe('return_jobs_refund_execution_unique');
    });
  });

  it('the database rejects a second return_job for the same refund execution', async () => {
    // Direct proof that the ambiguous state cannot be seeded at all.
    await inRolledBackTransaction(async (trx) => {
      const { rows } = await trx.raw(
        `SELECT lasyncro_order_id, lasyncro_refund_execution_id
           FROM return_jobs
          WHERE return_job_id = ?`,
        [fixture.deterministicJobId],
      );
      const { lasyncro_order_id, lasyncro_refund_execution_id } = rows[0];

      await expect(
        trx.raw(
          `INSERT INTO return_jobs
             (shop_id, origin, lasyncro_refund_execution_id, lasyncro_order_id, status, source, created_at, updated_at)
           VALUES (?, 'customer_return', ?, ?, 'awaiting_decision', 'system_auto', ?, ?)`,
          [fixture.shopId, lasyncro_refund_execution_id, lasyncro_order_id, now, now],
        ),
      ).rejects.toThrow(/return_jobs_refund_execution_unique|duplicate key/i);
    });
  });
});
