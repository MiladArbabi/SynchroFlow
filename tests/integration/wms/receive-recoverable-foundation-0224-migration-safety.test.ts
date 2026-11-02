// S8-C5 / S4-1 — migration 0224 recoverable Receive exception foundation.
//
//   F1 head carries every 0224 object; enum values exist.
//   F2 disposition is explicit: recoverable_held only for defect /
//      packaging_damage and never shortfall accounting; unknown values refused.
//   F3 quantity_held_recoverable >= 0 under the unchanged 0208 identity.
//   F4 one Receive task per (shop, LSU); other sources and shops unaffected.
//   F5 held / discarded unit statuses and held_placed_at are usable.
//   M1 without 0224 evidence, legacy rows survive DOWN → UP.
//   M2 DOWN refuses while any 0224 evidence exists, leaving schema and data.
//
// MECHANISM (precedent: receive-delivery-accounting-0208-migration-safety.test.ts)
//   The harness migrates the disposable DB to head. Every scenario runs in its
//   OWN migration-role transaction that is ALWAYS rolled back; constraint probes
//   and migration calls settle inside savepoints. Nothing is committed except
//   the two tenant shops.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0224 from
  '../../../apps/backend/migrations/20261028120000_0224_receive_recoverable_exception_foundation';

jest.setTimeout(120000);

let db: Knex;
let shopId: number;
let otherShopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `S4-1 0224 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
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

async function enumValues(trx: Knex.Transaction, type: string): Promise<string[]> {
  const r = await trx.raw(
    `SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ? ORDER BY e.enumsortorder`,
    [type],
  );
  return r.rows.map((row: any) => row.v);
}

/** Every 0224-owned object that DOWN removes. Enum values intentionally stay. */
async function schema0224(trx: Knex.Transaction) {
  const r = await trx.raw(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'receive_exceptions' AND column_name = 'disposition') AS disposition,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'inventory_units' AND column_name = 'held_placed_at') AS held_placed_at,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'problem_center_tasks' AND column_name = 'lasyncro_unit_id') AS task_unit,
      to_regtype('receive_exception_disposition') IS NOT NULL AS disposition_type,
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receive_exceptions_disposition_valid') AS disposition_check,
      (SELECT indexdef FROM pg_indexes WHERE indexname = 'problem_center_receive_unit_unique') AS task_index,
      (SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'receive_delivery_disposition_valid') AS held_check
  `);
  const row = r.rows[0];
  return {
    disposition: row.disposition,
    held_placed_at: row.held_placed_at,
    task_unit: row.task_unit,
    disposition_type: row.disposition_type,
    disposition_check: row.disposition_check,
    task_index: row.task_index,
    held_allows_positive: /quantity_held_recoverable >= 0/.test(row.held_check ?? ''),
    held_forced_zero: /quantity_held_recoverable = 0/.test(row.held_check ?? ''),
  };
}

const HEAD = {
  disposition: true,
  held_placed_at: true,
  task_unit: true,
  disposition_type: true,
  disposition_check: true,
  task_index: expect.stringMatching(
    /UNIQUE INDEX problem_center_receive_unit_unique ON public\.problem_center_tasks USING btree \(shop_id, lasyncro_unit_id\) WHERE \(\(source = 'receive'::problem_center_source\) AND \(lasyncro_unit_id IS NOT NULL\)\)/,
  ),
  held_allows_positive: true,
  held_forced_zero: false,
};
const PRE_0224 = {
  disposition: false,
  held_placed_at: false,
  task_unit: false,
  disposition_type: false,
  disposition_check: false,
  task_index: null,
  held_allows_positive: false,
  held_forced_zero: true,
};

type Fixture = { variantId: string; receiveJobId: string; receiveJobLineId: string };

/** One tenant PO → Receive job → line for a fresh variant (legacy shape: no 0224 evidence). */
async function seedLine(trx: Knex.Transaction, shop: number, quantityExpected = 5): Promise<Fixture> {
  await asTenant(trx, shop);
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await trx('products').insert({
    lasyncro_product_id: productId, shop_id: shop, title: 'S4-1 0224 product', status: 'active', product_type: 'physical',
  });
  await trx('variants').insert({
    lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop,
    sku: `S41-${variantId.slice(0, 8)}`, title: 'S4-1 0224 variant', unit_cost: '1.00', status: 'active',
  });
  const [supplier] = await trx('suppliers').insert({ shop_id: shop, name: `S4-1 0224 ${crypto.randomUUID()}` }).returning('id');
  const [po] = await trx('purchase_orders').insert({ shop_id: shop, supplier_id: supplier.id, status: 'shipped' }).returning('id');
  const [poLine] = await trx('purchase_order_line_items').insert({
    po_id: po.id, shop_id: shop, lasyncro_variant_id: variantId, description: 'S4-1 0224 line',
    quantity_ordered: quantityExpected, quantity_received: 0, unit_cost_cents: 100,
  }).returning('id');
  const [job] = await trx('receive_jobs').insert({
    shop_id: shop, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2,
  }).returning('receive_job_id');
  const [line] = await trx('receive_job_lines').insert({
    shop_id: shop, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id,
    lasyncro_variant_id: variantId, quantity_expected: quantityExpected,
  }).returning('receive_job_line_id');
  return { variantId, receiveJobId: job.receive_job_id, receiveJobLineId: line.receive_job_line_id };
}

function exceptionRow(f: Fixture, shop: number, fields: Record<string, unknown>) {
  return {
    shop_id: shop,
    receive_job_id: f.receiveJobId,
    receive_job_line_id: f.receiveJobLineId,
    lasyncro_variant_id: f.variantId,
    quantity_affected: 1,
    raised_at: new Date(),
    ...fields,
  };
}

function taskRow(f: Fixture, shop: number, fields: Record<string, unknown>) {
  return {
    shop_id: shop,
    status: 'open',
    source: 'receive',
    lasyncro_variant_id: f.variantId,
    quantity: 1,
    exception_type: 'defect',
    ...fields,
  };
}

function unitRow(f: Fixture, shop: number, sequence: number, fields: Record<string, unknown>) {
  return {
    shop_id: shop,
    lasyncro_unit_id: `LSU-${crypto.randomBytes(4).toString('hex')}`,
    lasyncro_variant_id: f.variantId,
    receive_job_line_id: f.receiveJobLineId,
    receive_sequence: sequence,
    ...fields,
  };
}

const failureCode = (outcome: { ok: boolean; error?: any }) => (outcome.ok ? null : outcome.error?.code ?? 'NO_CODE');

async function createShop(label: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s41-0224-${label}-${unique}`);
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
    expect(await schema0224(trx)).toEqual(HEAD);
  });
}

describe('S4-1 — migration 0224 recoverable Receive exception foundation', () => {
  it('F1 — head carries every 0224 object and the new enum values', async () => {
    await inRolledBackTransaction(async (trx) => {
      expect(await schema0224(trx)).toEqual(HEAD);
      expect(await enumValues(trx, 'receive_exception_disposition')).toEqual(['non_recoverable', 'recoverable_held']);
      expect(await enumValues(trx, 'inventory_unit_lifecycle_status')).toEqual(expect.arrayContaining(['held', 'discarded']));
      expect(await enumValues(trx, 'stow_task_trigger')).toEqual(expect.arrayContaining(['receive_recovery']));
    });
  });

  it('F2 — disposition is explicit: recoverable_held only for defect / packaging_damage, never shortfall', async () => {
    await inRolledBackTransaction(async (trx) => {
      const f = await seedLine(trx, shopId);
      const insert = (fields: Record<string, unknown>) =>
        inSavepoint(trx, (sp) => sp('receive_exceptions').insert(exceptionRow(f, shopId, fields)));

      expect({
        legacyNull: failureCode(await insert({ exception_type: 'defect', accounting_role: 'shortfall', counts_toward_shortfall: true })),
        heldDefect: failureCode(await insert({ exception_type: 'defect', disposition: 'recoverable_held' })),
        heldPackaging: failureCode(await insert({ exception_type: 'packaging_damage', disposition: 'recoverable_held' })),
        nonRecoverableMissing: failureCode(await insert({ exception_type: 'missing_item', disposition: 'non_recoverable', accounting_role: 'shortfall', counts_toward_shortfall: true })),
        heldMissing: failureCode(await insert({ exception_type: 'missing_item', disposition: 'recoverable_held' })),
        heldWrongItem: failureCode(await insert({ exception_type: 'wrong_item', disposition: 'recoverable_held' })),
        heldShortfallRole: failureCode(await insert({ exception_type: 'defect', disposition: 'recoverable_held', accounting_role: 'shortfall', counts_toward_shortfall: true })),
        heldCountsShortfall: failureCode(await insert({ exception_type: 'defect', disposition: 'recoverable_held', counts_toward_shortfall: true })),
        unknownValue: failureCode(await insert({ exception_type: 'defect', disposition: 'recovered' })),
      }).toEqual({
        legacyNull: null,
        heldDefect: null,
        heldPackaging: null,
        nonRecoverableMissing: null,
        heldMissing: '23514',
        heldWrongItem: '23514',
        heldShortfallRole: '23514',
        heldCountsShortfall: '23514',
        unknownValue: '22P02',
      });
    });
  });

  it('F3 — quantity_held_recoverable may be positive; the delivered identity is unchanged', async () => {
    await inRolledBackTransaction(async (trx) => {
      const f = await seedLine(trx, shopId, 5);
      const update = (fields: Record<string, unknown>) =>
        inSavepoint(trx, (sp) => sp('receive_job_lines')
          .where({ shop_id: shopId, receive_job_line_id: f.receiveJobLineId }).update(fields));
      const inspected = (delivered: number) => ({
        inspection_complete: true, quantity_accepted: 3, quantity_rejected: 1, quantity_held_recoverable: 1,
        quantity_missing: 0, quantity_deferred: 0, quantity_delivered: delivered,
      });

      expect({
        heldNegative: failureCode(await update({ quantity_held_recoverable: -1 })),
        identityBroken: failureCode(await update(inspected(4))),
        identityHolds: failureCode(await update(inspected(5))),
      }).toEqual({ heldNegative: '23514', identityBroken: '23514', identityHolds: null });
    });
  });

  it('F4 — one Receive task per (shop, LSU); other sources, other shops and NULL units are unaffected', async () => {
    await inRolledBackTransaction(async (trx) => {
      const a = await seedLine(trx, shopId);
      const b = await seedLine(trx, otherShopId);
      const lsu = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      const insert = (shop: number, f: Fixture, fields: Record<string, unknown>) =>
        inSavepoint(trx, async (sp) => {
          await asTenant(sp, shop);
          await sp('problem_center_tasks').insert(taskRow(f, shop, fields));
        });

      expect({
        first: failureCode(await insert(shopId, a, { lasyncro_unit_id: lsu })),
        duplicate: failureCode(await insert(shopId, a, { lasyncro_unit_id: lsu })),
        otherSource: failureCode(await insert(shopId, a, { source: 'pick', lasyncro_unit_id: lsu })),
        otherShop: failureCode(await insert(otherShopId, b, { lasyncro_unit_id: lsu })),
        nullUnitOne: failureCode(await insert(shopId, a, { lasyncro_unit_id: null })),
        nullUnitTwo: failureCode(await insert(shopId, a, { lasyncro_unit_id: null })),
      }).toEqual({
        first: null,
        duplicate: '23505',
        otherSource: null,
        otherShop: null,
        nullUnitOne: null,
        nullUnitTwo: null,
      });
    });
  });

  it('F5 — held / discarded unit statuses and held_placed_at are usable', async () => {
    await inRolledBackTransaction(async (trx) => {
      const f = await seedLine(trx, shopId);
      const insert = (sequence: number, fields: Record<string, unknown>) =>
        inSavepoint(trx, (sp) => sp('inventory_units').insert(unitRow(f, shopId, sequence, fields)));

      expect({
        held: failureCode(await insert(1, { status: 'held', held_placed_at: new Date() })),
        discarded: failureCode(await insert(2, { status: 'discarded' })),
        unknown: failureCode(await insert(3, { status: 'recovering' })),
      }).toEqual({ held: null, discarded: null, unknown: '22P02' });
    });
  });

  it('M1 — without 0224 evidence: legacy rows survive DOWN → UP and the schema round-trips', async () => {
    try {
      await inRolledBackTransaction(async (trx) => {
        expect(await schema0224(trx)).toEqual(HEAD);
        const f = await seedLine(trx, shopId);
        await trx('receive_exceptions').insert(exceptionRow(f, shopId, {
          exception_type: 'defect', accounting_role: 'shortfall', counts_toward_shortfall: true,
        }));
        await trx('inventory_units').insert(unitRow(f, shopId, 1, { status: 'received' }));
        await trx('problem_center_tasks').insert(taskRow(f, shopId, { source: 'pick', exception_type: 'item_missing' }));
        const legacy = async () => ({
          exceptions: await trx('receive_exceptions').where({ shop_id: shopId, receive_job_line_id: f.receiveJobLineId })
            .select('exception_type', 'accounting_role', 'quantity_affected'),
          units: await trx('inventory_units').where({ shop_id: shopId, receive_job_line_id: f.receiveJobLineId })
            .select('status', 'receive_sequence'),
          tasks: await trx('problem_center_tasks').where({ shop_id: shopId, lasyncro_variant_id: f.variantId })
            .select('source', 'exception_type', 'status'),
        });
        const before = await legacy();

        expect(await inSavepoint(trx, (sp) => migration0224.down(sp))).toEqual({ ok: true });
        expect(await schema0224(trx)).toEqual(PRE_0224);
        await asTenant(trx, shopId);
        expect(await legacy()).toEqual(before);

        expect(await inSavepoint(trx, (sp) => migration0224.up(sp))).toEqual({ ok: true });
        expect(await schema0224(trx)).toEqual(HEAD);
        await asTenant(trx, shopId);
        expect(await legacy()).toEqual(before);
      });
    } finally {
      await expectHeadRestored();
    }
  });

  type EvidenceKind = 'held_line' | 'disposition' | 'held_unit' | 'placed_unit' | 'unit_task' | 'recovery_stow';

  async function seedEvidence(trx: Knex.Transaction, kind: EvidenceKind): Promise<void> {
    const f = await seedLine(trx, shopId);
    const write: Record<EvidenceKind, () => Promise<unknown>> = {
      held_line: () => trx('receive_job_lines')
        .where({ shop_id: shopId, receive_job_line_id: f.receiveJobLineId }).update({ quantity_held_recoverable: 1 }),
      disposition: () => trx('receive_exceptions').insert(exceptionRow(f, shopId, { exception_type: 'missing_item', disposition: 'non_recoverable' })),
      held_unit: () => trx('inventory_units').insert(unitRow(f, shopId, 1, { status: 'held' })),
      placed_unit: () => trx('inventory_units').insert(unitRow(f, shopId, 1, { status: 'stowed', held_placed_at: new Date() })),
      unit_task: () => trx('problem_center_tasks').insert(taskRow(f, shopId, { lasyncro_unit_id: `LSU-${crypto.randomBytes(4).toString('hex')}` })),
      recovery_stow: () => trx('stow_tasks').insert({
        shop_id: shopId, lasyncro_variant_id: f.variantId, quantity: 1, status: 'pending', trigger: 'receive_recovery',
      }),
    };
    await write[kind]();
  }

  it.each<EvidenceKind>(['held_line', 'disposition', 'held_unit', 'placed_unit', 'unit_task', 'recovery_stow'])(
    'M2 — DOWN refuses with %s evidence, leaving the 0224 schema in place',
    async (kind) => {
      try {
        await inRolledBackTransaction(async (trx) => {
          await seedEvidence(trx, kind);
          const outcome = await inSavepoint(trx, (sp) => migration0224.down(sp));
          expect(outcome.ok).toBe(false);
          expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_RECOVERY_ROLLBACK_BLOCKED/);
          expect(await schema0224(trx)).toEqual(HEAD);
        });
      } finally {
        await expectHeadRestored();
      }
    },
  );
});
