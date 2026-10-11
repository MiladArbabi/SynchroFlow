// GH-1245 — migration 0208 rollback and provenance safety.
//
//   0208 down must refuse, before dropping anything, while persisted v2 Receive
//             or pending-delivery evidence exists; v1 accounting is never
//             reconstructed from v2 data.
//   0208 down → up must still work when no such evidence exists.
//   closed_by / inspected_by follow the 0097/0099 provenance convention:
//             ON DELETE SET NULL.
//
// MECHANISM (precedent: opening-inventory-cutover-shop-gid-migration-safety.test.ts)
//   The harness migrates the disposable DB to head (through 0208). Each scenario
//   opens its OWN migration-role transaction, shapes only 0208-owned columns,
//   invokes the REAL 0208 migration source inside a savepoint, asserts, then
//   ALWAYS rolls back. PostgreSQL DDL is transactional, so the shared
//   disposable DB is left at head regardless of outcome.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0208 from
  '../../../apps/backend/migrations/20261011120000_0208_receive_delivery_accounting';

jest.setTimeout(120000);

const COLUMNS_0208 = [
  'purchase_order_line_items.quantity_pending_delivery',
  'receive_exceptions.device_event_id',
  'receive_job_lines.inspected_by',
  'receive_job_lines.inspection_device_event_id',
  'receive_job_lines.quantity_deferred',
  'receive_job_lines.quantity_delivered',
  'receive_job_lines.quantity_held_recoverable',
  'receive_job_lines.quantity_missing',
  'receive_jobs.closed_by',
  'receive_jobs.delivery_accounting_version',
];
const INDEXES_0208 = [
  'receive_exception_device_event_unique',
  'receive_inspection_device_event_unique',
  'receive_one_active_job_per_po',
];
const CONSTRAINTS_0208 = [
  'po_pending_delivery_nonnegative',
  'receive_accounting_version_valid',
  'receive_delivery_disposition_valid',
];

let db: Knex;
let shopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `GH-1245 0208 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

/** Run `body` in a migration-role transaction that is ALWAYS rolled back. */
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

/** Settle a migration call inside a savepoint so a failure cannot abort the outer trx. */
async function inSavepoint(
  trx: Knex.Transaction,
  body: (sp: Knex.Transaction) => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return trx.transaction(body).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/** Every 0208-owned schema object, plus the provenance FK delete rules. */
async function schema0208(trx: Knex.Transaction) {
  const columns = await trx.raw(
    `SELECT table_name || '.' || column_name AS name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name || '.' || column_name = ANY(?::text[])
      ORDER BY 1`,
    [COLUMNS_0208],
  );
  const indexes = await trx.raw(
    `SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY(?::text[]) ORDER BY 1`,
    [INDEXES_0208],
  );
  const constraints = await trx.raw(
    `SELECT conname AS name FROM pg_constraint WHERE conname = ANY(?::text[]) ORDER BY 1`,
    [CONSTRAINTS_0208],
  );
  // confdeltype 'n' = ON DELETE SET NULL.
  const provenanceFks = await trx.raw(
    `SELECT t.relname || '.' || a.attname AS name, c.confdeltype AS on_delete
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_class r ON r.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND r.relname = 'users'
        AND t.relname || '.' || a.attname IN ('receive_jobs.closed_by', 'receive_job_lines.inspected_by')
      ORDER BY 1`,
  );
  return {
    columns: columns.rows.map((r: any) => r.name),
    indexes: indexes.rows.map((r: any) => r.name),
    constraints: constraints.rows.map((r: any) => r.name),
    provenanceFks: provenanceFks.rows,
  };
}

const HEAD_SCHEMA = {
  columns: COLUMNS_0208,
  indexes: INDEXES_0208,
  constraints: CONSTRAINTS_0208,
  provenanceFks: [
    { name: 'receive_job_lines.inspected_by', on_delete: 'n' },
    { name: 'receive_jobs.closed_by', on_delete: 'n' },
  ],
};
const PRE_0208_SCHEMA = { columns: [], indexes: [], constraints: [], provenanceFks: [] };

/**
 * Shape the shared disposable DB to "no 0208 evidence" inside the caller's
 * rolled-back transaction: other suites in the same run legitimately persist
 * v2 rows. Touches only 0208-owned columns, resetting them to their legacy
 * defaults; never committed.
 */
async function withoutPersistedEvidence(trx: Knex.Transaction): Promise<void> {
  await trx.raw(`SET LOCAL row_security = off`);
  await trx.raw(`
    UPDATE receive_jobs SET delivery_accounting_version = 1, closed_by = NULL
     WHERE delivery_accounting_version <> 1 OR closed_by IS NOT NULL;
    UPDATE receive_job_lines
       SET quantity_delivered = NULL, quantity_missing = NULL, quantity_deferred = NULL,
           quantity_held_recoverable = NULL, inspected_by = NULL, inspection_device_event_id = NULL
     WHERE quantity_delivered IS NOT NULL OR quantity_missing IS NOT NULL OR quantity_deferred IS NOT NULL
        OR quantity_held_recoverable IS NOT NULL OR inspected_by IS NOT NULL OR inspection_device_event_id IS NOT NULL;
    UPDATE receive_exceptions SET device_event_id = NULL WHERE device_event_id IS NOT NULL;
    UPDATE purchase_order_line_items SET quantity_pending_delivery = NULL WHERE quantity_pending_delivery IS NOT NULL;
  `);
}

type EvidenceKind = 'v2_receive_job' | 'pending_delivery';

/** One real tenant PO carrying exactly one kind of 0208 evidence. */
async function seedEvidence(trx: Knex.Transaction, kind: EvidenceKind) {
  await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shopId)]);
  const [supplier] = await trx('suppliers')
    .insert({ shop_id: shopId, name: `GH1245 0208 ${crypto.randomUUID()}` })
    .returning('id');
  const [po] = await trx('purchase_orders')
    .insert({ shop_id: shopId, supplier_id: supplier.id, status: 'partially_received' })
    .returning('id');
  const [poLine] = await trx('purchase_order_line_items')
    .insert({
      po_id: po.id,
      shop_id: shopId,
      description: 'GH1245 0208 evidence line',
      quantity_ordered: 5,
      quantity_received: 3,
      unit_cost_cents: 100,
      quantity_pending_delivery: kind === 'pending_delivery' ? 2 : null,
    })
    .returning('id');
  if (kind === 'v2_receive_job') {
    await trx('receive_jobs').insert({
      shop_id: shopId, po_id: po.id, status: 'pending', delivery_accounting_version: 2,
    });
  }

  return async () => ({
    poLine: await trx('purchase_order_line_items')
      .where({ shop_id: shopId, id: poLine.id })
      .first('quantity_ordered', 'quantity_received', 'quantity_pending_delivery'),
    jobs: await trx('receive_jobs')
      .where({ shop_id: shopId, po_id: po.id })
      .select('status', 'delivery_accounting_version'),
  });
}

async function createShop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `gh1245-0208-${unique}`);
    await setTenantContext(trx, id);
    return id;
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
    pool: { min: 0, max: 2 },
  });
  shopId = await createShop();
});

afterAll(async () => {
  if (db) await db.destroy();
});

/** Rollback must leave the shared disposable DB at head, RED or GREEN. */
async function expectHeadRestored(label: string): Promise<void> {
  await inRolledBackTransaction(async (trx) => {
    expect(await schema0208(trx)).toEqual(HEAD_SCHEMA);
    // eslint-disable-next-line no-console
    console.info('[GH1245_0208_MIG_HEAD_RESTORED]', label);
  });
}

describe('GH-1245 — migration 0208 never destroys persisted delivery evidence', () => {
  it('M1 — without persisted evidence: head has SET NULL provenance FKs, and DOWN → UP round-trips', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        expect(await schema0208(trx)).toEqual(HEAD_SCHEMA);
        await withoutPersistedEvidence(trx);

        const down = await inSavepoint(trx, (sp) => migration0208.down(sp));
        expect(down).toEqual({ ok: true });
        expect(await schema0208(trx)).toEqual(PRE_0208_SCHEMA);

        const up = await inSavepoint(trx, (sp) => migration0208.up(sp));
        expect(up).toEqual({ ok: true });
        expect(await schema0208(trx)).toEqual(HEAD_SCHEMA);
      });
    } finally {
      await expectHeadRestored('M1');
    }
  });

  it.each<EvidenceKind>(['v2_receive_job', 'pending_delivery'])(
    'M2 — DOWN refuses with %s evidence, leaving schema and data unchanged',
    async (kind) => {
      try {
        await inRolledBackTransaction(async (trx) => {
          await withoutPersistedEvidence(trx);
          const evidence = await seedEvidence(trx, kind);
          const before = await evidence();

          const outcome = await inSavepoint(trx, (sp) => migration0208.down(sp));

          expect(outcome.ok).toBe(false);
          expect(String((outcome as any).error?.message)).toMatch(
            /RECEIVE_DELIVERY_ACCOUNTING_ROLLBACK_BLOCKED/,
          );
          expect(await schema0208(trx)).toEqual(HEAD_SCHEMA);
          expect(await evidence()).toEqual(before);
        });
      } finally {
        await expectHeadRestored(`M2 ${kind}`);
      }
    },
  );
});
