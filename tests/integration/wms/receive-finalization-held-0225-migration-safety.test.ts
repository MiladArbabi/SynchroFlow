// S8-C5 / S4-3A — migration 0225 grouped finalization held accounting.
//
//   F1 head: quantity_held_recoverable NOT NULL DEFAULT 0 CHECK >= 0, and the
//      balanced CHECK counts held units on the delivered side.
//   F2 legacy and held allocations balance; unbalanced or negative are refused.
//   F3 tenant isolation, RLS and the append-only runtime grant are unchanged.
//   M1 without held evidence, legacy rows survive DOWN → UP unchanged.
//   M2 DOWN refuses while held evidence exists, leaving schema and data.
//
// MECHANISM (precedent: receive-recoverable-foundation-0224-migration-safety.test.ts)
//   The harness migrates the disposable DB to head. Every scenario runs in its
//   OWN migration-role transaction that is ALWAYS rolled back, so no fixture
//   row survives to other suites; constraint probes and migration calls settle
//   inside savepoints. Only the tenant shops are committed.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0225 from
  '../../../apps/backend/migrations/20261028150000_0225_receive_finalization_held_recoverable';

jest.setTimeout(120000);

const TABLE = 'receive_reconciliation_finalization_lines';

let db: Knex;
let shopId: number;
let otherShopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `S4-3A 0225 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
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

/** Settle a call inside a savepoint so a failure cannot abort the outer trx. */
async function inSavepoint(
  trx: Knex.Transaction,
  body: (sp: Knex.Transaction) => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; error: any }> {
  return trx.transaction(async (sp) => { await body(sp); }).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const asTenant = (trx: Knex.Transaction, id: number) =>
  trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(id)]);

const failureCode = (outcome: { ok: boolean; error?: any }) => (outcome.ok ? null : outcome.error?.code ?? 'NO_CODE');

/** Every 0225-owned schema fact that DOWN reverses. */
async function schema0225(trx: Knex.Transaction) {
  const r = await trx.raw(
    `
    SELECT
      (SELECT is_nullable FROM information_schema.columns
        WHERE table_name = ? AND column_name = 'quantity_held_recoverable') AS held_nullable,
      (SELECT column_default FROM information_schema.columns
        WHERE table_name = ? AND column_name = 'quantity_held_recoverable') AS held_default,
      EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'receive_reconciliation_finalization_lines_held_nonnegative') AS held_check,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'receive_reconciliation_finalization_lines_balanced') AS balanced
    `,
    [TABLE, TABLE],
  );
  const row = r.rows[0];
  return {
    held_nullable: row.held_nullable,
    held_default: row.held_default,
    held_check: row.held_check,
    balanced_counts_held: /quantity_held_recoverable/.test(row.balanced ?? ''),
    balanced_present: row.balanced != null,
  };
}

const HEAD = {
  held_nullable: 'NO',
  held_default: '0',
  held_check: true,
  balanced_counts_held: true,
  balanced_present: true,
};
const PRE_0225 = {
  held_nullable: null,
  held_default: null,
  held_check: false,
  balanced_counts_held: false,
  balanced_present: true,
};

type Finalization = { shop: number; receiveJobId: string; reconciliationId: string; lineIds: string[] };

/** One tenant PO → Receive job with `lines` lines, one revision and one finalization (no lines yet). */
async function seedFinalization(trx: Knex.Transaction, shop: number, lines: number): Promise<Finalization> {
  await asTenant(trx, shop);
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await trx('products').insert({
    lasyncro_product_id: productId, shop_id: shop, title: 'S4-3A 0225 product', status: 'active', product_type: 'physical',
  });
  await trx('variants').insert({
    lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop,
    sku: `S43A-${variantId.slice(0, 8)}`, title: 'S4-3A 0225 variant', unit_cost: '1.00', status: 'active',
  });
  const [supplier] = await trx('suppliers').insert({ shop_id: shop, name: `S4-3A 0225 ${crypto.randomUUID()}` }).returning('id');
  const [po] = await trx('purchase_orders').insert({ shop_id: shop, supplier_id: supplier.id, status: 'shipped' }).returning('id');
  const [job] = await trx('receive_jobs').insert({
    shop_id: shop, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2,
  }).returning('receive_job_id');
  const lineIds: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    const [poLine] = await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop, lasyncro_variant_id: i === 0 ? variantId : null, description: `S4-3A 0225 line ${i}`,
      quantity_ordered: 5, quantity_received: 0, unit_cost_cents: 100,
    }).returning('id');
    const [line] = await trx('receive_job_lines').insert({
      shop_id: shop, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id,
      lasyncro_variant_id: i === 0 ? variantId : null, quantity_expected: 5,
    }).returning('receive_job_line_id');
    lineIds.push(line.receive_job_line_id);
  }
  const [revision] = await trx('receive_reconciliation_revisions').insert({
    shop_id: shop, receive_job_id: job.receive_job_id, revision_number: 1, base_revision_id: null,
    device_event_id: crypto.randomUUID(), payload: JSON.stringify({ lines: [] }), payload_hash: 'S4-3A-0225',
  }).returning('revision_id');
  const [finalization] = await trx('receive_reconciliation_finalizations').insert({
    shop_id: shop, receive_job_id: job.receive_job_id, po_id: po.id, revision_id: revision.revision_id,
    device_event_id: crypto.randomUUID(), payload_hash: 'S4-3A-0225',
  }).returning('reconciliation_id');
  return { shop, receiveJobId: job.receive_job_id, reconciliationId: finalization.reconciliation_id, lineIds };
}

type Allocation = {
  expected?: number; accepted: number; rejected: number; missing: number; deferred: number; overage?: number; held?: number;
};

function lineRow(f: Finalization, index: number, a: Allocation) {
  return {
    shop_id: f.shop,
    reconciliation_id: f.reconciliationId,
    receive_job_id: f.receiveJobId,
    receive_job_line_id: f.lineIds[index],
    quantity_expected: a.expected ?? 5,
    quantity_count_confirmed: a.accepted,
    count_confirmation_event_id: crypto.randomUUID(),
    quantity_accepted: a.accepted,
    quantity_rejected: a.rejected,
    quantity_missing: a.missing,
    quantity_deferred: a.deferred,
    quantity_overage_approved: a.overage ?? 0,
    ...(a.held === undefined ? {} : { quantity_held_recoverable: a.held }),
  };
}

const allocationColumns = [
  'receive_job_line_id', 'quantity_expected', 'quantity_accepted', 'quantity_rejected',
  'quantity_missing', 'quantity_deferred', 'quantity_overage_approved',
];

async function createShop(label: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s43a-0225-${label}-${unique}`);
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
  shopId = await createShop('a');
  otherShopId = await createShop('b');
});

afterAll(async () => {
  if (db) await db.destroy();
});

/** Rollback must leave the shared disposable DB at head, RED or GREEN. */
async function expectHeadRestored(): Promise<void> {
  await inRolledBackTransaction(async (trx) => {
    expect(await schema0225(trx)).toEqual(HEAD);
  });
}

describe('S4-3A — migration 0225 grouped finalization held accounting', () => {
  it('F1 — head carries a non-null, defaulted, non-negative held column counted by the balanced CHECK', async () => {
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0225(trx)).toEqual(HEAD);
    });
  });

  it('F2 — legacy and held allocations balance; unbalanced and negative allocations are refused', async () => {
    await inRolledBackTransaction(async (trx) => {
      const f = await seedFinalization(trx, shopId, 7);
      const insert = (index: number, a: Allocation) =>
        inSavepoint(trx, (sp) => sp(TABLE).insert(lineRow(f, index, a)));

      expect({
        legacyDefault: failureCode(await insert(0, { accepted: 3, rejected: 1, missing: 1, deferred: 0 })),
        held: failureCode(await insert(1, { accepted: 2, rejected: 1, held: 1, missing: 1, deferred: 0 })),
        heldWithOverage: failureCode(await insert(2, { accepted: 3, rejected: 1, held: 2, missing: 0, deferred: 0, overage: 1 })),
        heldMakesLegacyShapeUnbalanced: failureCode(await insert(3, { accepted: 3, rejected: 1, held: 1, missing: 1, deferred: 0 })),
        heldUnaccounted: failureCode(await insert(4, { accepted: 2, rejected: 1, held: 0, missing: 1, deferred: 0 })),
        heldNegative: failureCode(await insert(5, { accepted: 3, rejected: 1, held: -1, missing: 2, deferred: 0 })),
        heldNull: failureCode(await insert(6, { accepted: 3, rejected: 1, held: null as unknown as number, missing: 1, deferred: 0 })),
      }).toEqual({
        legacyDefault: null,
        held: null,
        heldWithOverage: null,
        heldMakesLegacyShapeUnbalanced: '23514',
        heldUnaccounted: '23514',
        heldNegative: '23514',
        heldNull: '23502',
      });

      const stored = await trx(TABLE).where({ shop_id: shopId, reconciliation_id: f.reconciliationId })
        .orderBy('quantity_held_recoverable').select('quantity_held_recoverable');
      expect(stored.map((r: any) => r.quantity_held_recoverable)).toEqual([0, 1, 2]);
    });
  });

  it('F3 — tenant isolation, forced RLS and the append-only runtime grant are unchanged', async () => {
    await inRolledBackTransaction(async (trx) => {
      const f = await seedFinalization(trx, shopId, 2);
      expect(failureCode(await inSavepoint(trx, (sp) =>
        sp(TABLE).insert(lineRow(f, 0, { accepted: 2, rejected: 1, held: 1, missing: 1, deferred: 0 }))))).toBeNull();

      // Schema posture is read under the migration role.
      const posture = await trx.raw(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                has_table_privilege('sf_app', c.oid, 'SELECT') AS can_select,
                has_table_privilege('sf_app', c.oid, 'INSERT') AS can_insert,
                has_table_privilege('sf_app', c.oid, 'UPDATE') AS can_update,
                has_table_privilege('sf_app', c.oid, 'DELETE') AS can_delete,
                has_table_privilege('sf_app', c.oid, 'TRUNCATE') AS can_truncate,
                (SELECT count(*)::int FROM pg_trigger t
                  WHERE t.tgrelid = c.oid AND t.tgname IN (?, ?)) AS append_only_triggers
           FROM pg_class c WHERE c.relname = ?`,
        [`${TABLE}_no_update`, `${TABLE}_no_delete`, TABLE],
      );
      expect(posture.rows[0]).toEqual({
        rls: true, forced: true, can_select: true, can_insert: true,
        can_update: false, can_delete: false, can_truncate: false, append_only_triggers: 2,
      });

      // The migration role is the cluster superuser and bypasses RLS, so tenant
      // isolation is asserted under the real runtime authority (precedent:
      // receive-line-recount-s8c5 asRuntimeRole). Reverts when the trx rolls back.
      await trx.raw('SET LOCAL SESSION AUTHORIZATION sf_app');
      const who = await trx.raw(
        `SELECT session_user AS s, current_user AS u, r.rolsuper AS super, r.rolbypassrls AS bypass
           FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(who.rows[0]).toEqual({ s: 'sf_app', u: 'sf_app', super: false, bypass: false });
      const visibleTo = async (tenant: number) => {
        await asTenant(trx, tenant);
        const row = await trx(TABLE).where({ reconciliation_id: f.reconciliationId }).count<{ n: string }>('* as n').first();
        return Number(row?.n);
      };

      // Positive control: the owning tenant sees its held allocation.
      expect(await visibleTo(shopId)).toBe(1);
      // Another tenant neither sees it nor may write one for this shop.
      expect(await visibleTo(otherShopId)).toBe(0);
      const crossTenant = await inSavepoint(trx, (sp) =>
        sp(TABLE).insert(lineRow(f, 1, { accepted: 2, rejected: 1, held: 1, missing: 1, deferred: 0 })));
      expect(failureCode(crossTenant)).toBe('42501');
      expect(await visibleTo(shopId)).toBe(1);
    });
  });

  it('M1 — without held evidence: legacy rows survive DOWN → UP and the schema round-trips', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        expect(await schema0225(trx)).toEqual(HEAD);
        const f = await seedFinalization(trx, shopId, 1);
        await trx(TABLE).insert(lineRow(f, 0, { accepted: 3, rejected: 1, missing: 1, deferred: 0 }));
        const legacy = () => trx(TABLE).where({ shop_id: shopId, reconciliation_id: f.reconciliationId }).select(allocationColumns);
        const before = await legacy();

        expect(await inSavepoint(trx, (sp) => migration0225.down(sp))).toEqual({ ok: true });
        expect(await schema0225(trx)).toEqual(PRE_0225);
        await asTenant(trx, shopId);
        expect(await legacy()).toEqual(before);

        expect(await inSavepoint(trx, (sp) => migration0225.up(sp))).toEqual({ ok: true });
        expect(await schema0225(trx)).toEqual(HEAD);
        await asTenant(trx, shopId);
        expect(await legacy()).toEqual(before);
        const held = await trx(TABLE).where({ shop_id: shopId, reconciliation_id: f.reconciliationId }).first('quantity_held_recoverable');
        expect(held.quantity_held_recoverable).toBe(0);
      });
    } finally {
      await expectHeadRestored();
    }
  });

  it('M2 — DOWN refuses while held evidence exists, leaving the 0225 schema and the row in place', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        const f = await seedFinalization(trx, shopId, 1);
        await trx(TABLE).insert(lineRow(f, 0, { accepted: 2, rejected: 1, held: 1, missing: 1, deferred: 0 }));
        const evidence = () => trx(TABLE).where({ shop_id: shopId, reconciliation_id: f.reconciliationId })
          .select([...allocationColumns, 'quantity_held_recoverable']);
        const before = await evidence();

        const outcome = await inSavepoint(trx, (sp) => migration0225.down(sp));
        expect(outcome.ok).toBe(false);
        expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_FINALIZATION_HELD_ROLLBACK_BLOCKED/);
        expect(await schema0225(trx)).toEqual(HEAD);
        await asTenant(trx, shopId);
        expect(await evidence()).toEqual(before);
      });
    } finally {
      await expectHeadRestored();
    }
  });
});
