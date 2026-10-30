// S8-C5 / S4-5-I1 — migration 0227 held recovery foundation.
//
//   F1 head carries every 0227 object: keys, checks, triggers, forced RLS, the
//      live-recovery-Stow index; sf_app holds exactly SELECT + INSERT on the
//      event table; no ledger/truth table gains a 0227 trigger.
//   F2 the runtime role is restricted (sf_app, not superuser, no BYPASSRLS).
//   R1 recovery: one pending recovery Stow from a closed, placed held unit; the
//      recovered event authorizes exactly held → stowed at its bin, Stow
//      completion and task closure; the unit is then ordinary stock.
//   R2 disposal: the discarded event authorizes exactly held → discarded in
//      place and task closure; the unit and task are then final.
//   R3 without an outcome event every exit is refused; a recorded outcome
//      authorizes only its own transition.
//   R4 one outcome per LSU / task / device event; one live recovery Stow per
//      task; disposal is refused while a recovery Stow is live.
//   R5 invalid custody, Receive state, Stow shape and Stow identity changes are
//      refused; non-recovery Stows and maintenance roles are unaffected.
//   R6 tenant isolation for events and recovery Stows.
//   R7 events are append-only for sf_app and the migration role.
//   M1 without 0227 evidence, DOWN → UP round-trips the schema and DOWN
//      restores the exact 0226 guard functions (compared against 0226 UP's own
//      definitions, so other suites' committed custody evidence is irrelevant).
//   M2 DOWN refuses while a recovery event or a recovery Stow exists.
//
// MECHANISM (precedent: receive-held-custody-0226-migration-safety)
//   The harness migrates the disposable DB to head. Every scenario runs in its
//   OWN transaction that is ALWAYS rolled back — migration-role scenarios via
//   `admin`, runtime scenarios via withTenant (sf_app). Probes settle inside
//   savepoints. Nothing is committed except the two tenant shops.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0226 from
  '../../../apps/backend/migrations/20261029120000_0226_receive_held_custody_events';
import * as migration0227 from
  '../../../apps/backend/migrations/20261029150000_0227_receive_held_recovery_foundation';

jest.setTimeout(120000);

let admin: Knex;
let shopId: number;
let otherShopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `S4-5 0227 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
        `disposable synchroflow_test_* database. Run via: npm run test:integration`,
    );
  }
}

const SENTINEL = new Error('__rollback__');

/** Migration-role transaction that is ALWAYS rolled back. */
async function asAdminRolledBack(body: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  try {
    await admin.transaction(async (trx) => { await body(trx); throw SENTINEL; });
  } catch (err) {
    if (err !== SENTINEL) throw err;
  }
}

/** sf_app tenant transaction that is ALWAYS rolled back. */
async function asRuntimeRolledBack(shop: number, body: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  try {
    await withTenant(shop, async (trx) => { await body(trx); throw SENTINEL; });
  } catch (err) {
    if (err !== SENTINEL) throw err;
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

const failure = (outcome: { ok: boolean; error?: any }) =>
  (outcome.ok ? null : `${outcome.error?.code ?? 'NO_CODE'} ${String(outcome.error?.message ?? '').match(/RECEIVE_HELD_RECOVERY_[A-Z_]+|RECEIVE_RECOVERY_STOW_[A-Z_]+|RECEIVE_HELD_CUSTODY_[A-Z_]+|append-only|permission denied|row-level security|foreign key|duplicate key|check constraint/)?.[0] ?? ''}`.trim());

/** Every 0227-owned object that DOWN removes. */
async function schema0227(trx: Knex.Transaction) {
  const r = await trx.raw(`
    SELECT
      to_regclass('public.receive_held_recovery_events') IS NOT NULL AS events_table,
      to_regclass('public.stow_tasks_receive_recovery_task_unique') IS NOT NULL AS stow_index,
      to_regtype('public.receive_held_recovery_outcome') IS NOT NULL AS outcome_type,
      (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
        WHERE conrelid = to_regclass('public.receive_held_recovery_events')) AS constraints,
      (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
        WHERE NOT tgisinternal AND tgname IN (
          'receive_held_recovery_events_validate', 'receive_held_recovery_events_no_update',
          'receive_held_recovery_events_no_delete', 'stow_tasks_guard_receive_recovery')) AS triggers,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
        WHERE oid = to_regclass('public.receive_held_recovery_events')) AS forced_rls,
      (SELECT count(*)::int FROM pg_policies
        WHERE tablename = 'receive_held_recovery_events'
          AND policyname = 'receive_held_recovery_events_tenant_isolation_policy'
          AND qual IS NOT NULL AND with_check IS NOT NULL) AS policy
  `);
  return r.rows[0];
}

const HEAD = {
  events_table: true,
  stow_index: true,
  outcome_type: true,
  constraints: [
    'receive_held_recovery_events_location_fk',
    'receive_held_recovery_events_pkey',
    'receive_held_recovery_events_shop_id_fkey',
    'receive_held_recovery_events_stow_shape',
    'receive_held_recovery_events_stow_task_id_fkey',
    'receive_held_recovery_events_task_unique',
    'receive_held_recovery_events_unit_fk',
    'receive_held_recovery_events_unit_unique',
  ],
  triggers: [
    'receive_held_recovery_events_no_delete',
    'receive_held_recovery_events_no_update',
    'receive_held_recovery_events_validate',
    'stow_tasks_guard_receive_recovery',
  ],
  forced_rls: true,
  policy: 1,
};
const PRE_0227 = {
  events_table: false,
  stow_index: false,
  outcome_type: false,
  constraints: null,
  triggers: null,
  forced_rls: null,
  policy: 0,
};

const guardSources = async (trx: Knex.Transaction) => (await trx.raw(`
  SELECT proname::text AS name, md5(prosrc) AS src FROM pg_proc
   WHERE proname IN ('guard_held_unit_custody', 'guard_receive_task_custody') ORDER BY proname`)).rows;

/** The two guard functions exactly as 0226 UP defines them, as CREATE OR REPLACE statements. */
async function guardDefinitions0226(): Promise<Array<[string, string]>> {
  const statements: string[] = [];
  await migration0226.up({ raw: async (sql: string) => { statements.push(sql); } } as unknown as Knex);
  const pattern = /CREATE FUNCTION (guard_held_unit_custody|guard_receive_task_custody)\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/g;
  return [...statements.join('\n').matchAll(pattern)]
    .map((m): [string, string] => [m[1], m[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')])
    .sort(([a], [b]) => a.localeCompare(b));
}

interface Fixture {
  variantId: string;
  receiveJobId: string;
  receiveJobLineId: string;
  bin: string;
  otherBin: string;
  pickBin: string;
}

interface HeldUnit { lsu: string; taskId: string }

/**
 * One tenant PO → Receive job → line, a warehouse with two problem bins and a
 * pick bin, all written through `trx` under the given tenant.
 */
async function seedLine(trx: Knex.Transaction, shop: number): Promise<Fixture> {
  await asTenant(trx, shop);
  const nonce = crypto.randomBytes(4).toString('hex');
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await trx('products').insert({
    lasyncro_product_id: productId, shop_id: shop, title: 'S4-5 0227 product', status: 'active', product_type: 'physical',
  });
  await trx('variants').insert({
    lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop,
    sku: `S45-${nonce}`, title: 'S4-5 0227 variant', unit_cost: '1.00', status: 'active',
  });
  const [supplier] = await trx('suppliers').insert({ shop_id: shop, name: `S4-5 0227 ${nonce}` }).returning('id');
  const [po] = await trx('purchase_orders').insert({ shop_id: shop, supplier_id: supplier.id, status: 'shipped' }).returning('id');
  const [poLine] = await trx('purchase_order_line_items').insert({
    po_id: po.id, shop_id: shop, lasyncro_variant_id: variantId, description: 'S4-5 0227 line',
    quantity_ordered: 3, quantity_received: 0, unit_cost_cents: 100,
  }).returning('id');
  const [job] = await trx('receive_jobs').insert({
    shop_id: shop, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2,
  }).returning('receive_job_id');
  const [line] = await trx('receive_job_lines').insert({
    shop_id: shop, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id,
    lasyncro_variant_id: variantId, quantity_expected: 3,
  }).returning('receive_job_line_id');

  const root = `S45-ROOT-${nonce}`;
  const [warehouse] = await trx('warehouses').insert({
    shop_id: shop, name: `S4-5 0227 ${nonce}`, root_location_code: root,
  }).returning('warehouse_id');
  const bin = `S45-PROB-${nonce}-A`;
  const otherBin = `S45-PROB-${nonce}-B`;
  const pickBin = `S45-PICK-${nonce}`;
  await trx('warehouse_locations').insert([
    { shop_id: shop, warehouse_id: warehouse.warehouse_id, location_code: root, type: 'warehouse', parent_location_code: null, active: true },
    ...[bin, otherBin, pickBin].map((location_code) => ({
      shop_id: shop, warehouse_id: warehouse.warehouse_id, location_code, type: 'bin', parent_location_code: root, active: true,
    })),
  ]);
  return { variantId, receiveJobId: job.receive_job_id, receiveJobLineId: line.receive_job_line_id, bin, otherBin, pickBin };
}

/** A held LSU plus its quantity-1 Receive task (the S4-3B shape). */
async function seedHeldUnit(trx: Knex.Transaction, shop: number, f: Fixture, sequence: number): Promise<HeldUnit> {
  const lsu = `LSU-${crypto.randomBytes(4).toString('hex')}`;
  await trx('inventory_units').insert({
    shop_id: shop, lasyncro_unit_id: lsu, lasyncro_variant_id: f.variantId,
    receive_job_line_id: f.receiveJobLineId, receive_sequence: sequence, status: 'held',
  });
  const [task] = await trx('problem_center_tasks').insert({
    shop_id: shop, status: 'open', source: 'receive', source_exception_id: crypto.randomUUID(),
    lasyncro_unit_id: lsu, lasyncro_variant_id: f.variantId, quantity: 1, exception_type: 'defect',
  }).returning('problem_task_id');
  return { lsu, taskId: task.problem_task_id as string };
}

/** The S4-4 placement write set: custody event, then unit and task. */
async function place(trx: Knex.Transaction, shop: number, unit: HeldUnit, location: string) {
  await trx('receive_held_custody_events').insert({
    shop_id: shop, device_event_id: crypto.randomUUID(), lasyncro_unit_id: unit.lsu,
    problem_task_id: unit.taskId, location_code: location, placed_by: null,
  });
  await trx('inventory_units').where({ shop_id: shop, lasyncro_unit_id: unit.lsu })
    .update({ held_placed_at: new Date(), current_location_code: location, updated_at: new Date() });
  await trx('problem_center_tasks').where({ shop_id: shop, problem_task_id: unit.taskId })
    .update({ problem_bin_location: location });
}

const closeJob = (trx: Knex.Transaction, shop: number, f: Fixture) =>
  trx('receive_jobs').where({ shop_id: shop, receive_job_id: f.receiveJobId })
    .update({ status: 'closed', closed_at: new Date() });

/** Closed Receive with `count` placed held units in f.bin. */
async function seedPlaced(trx: Knex.Transaction, shop: number, count: number, close = true) {
  const f = await seedLine(trx, shop);
  const units: HeldUnit[] = [];
  for (let i = 1; i <= count; i += 1) {
    const unit = await seedHeldUnit(trx, shop, f, i);
    await place(trx, shop, unit, f.bin);
    units.push(unit);
  }
  if (close) await closeJob(trx, shop, f);
  return { f, units };
}

const stowRow = (shop: number, f: Fixture, unit: HeldUnit, fields: Record<string, unknown> = {}) => ({
  shop_id: shop, lasyncro_variant_id: f.variantId, quantity: 1, status: 'pending',
  trigger: 'receive_recovery', source_task_id: unit.taskId, location_code: f.pickBin, ...fields,
});

async function insertStow(trx: Knex.Transaction, row: Record<string, unknown>): Promise<string> {
  const [stow] = await trx('stow_tasks').insert(row).returning('stow_task_id');
  return stow.stow_task_id as string;
}

const eventRow = (shop: number, unit: HeldUnit, outcome: 'recovered' | 'discarded', location: string,
  fields: Record<string, unknown> = {}) => ({
  shop_id: shop, device_event_id: crypto.randomUUID(), lasyncro_unit_id: unit.lsu, problem_task_id: unit.taskId,
  outcome, location_code: location, recorded_by: null, ...fields,
});

const claimStow = (trx: Knex.Transaction, shop: number, stowId: string) =>
  trx('stow_tasks').where({ shop_id: shop, stow_task_id: stowId }).update({ status: 'in_progress', claimed_at: new Date() });

const unitState = (trx: Knex.Transaction, shop: number, lsu: string) =>
  trx('inventory_units').where({ shop_id: shop, lasyncro_unit_id: lsu })
    .first('status', 'current_location_code', trx.raw('held_placed_at IS NOT NULL AS placed'));

async function createShop(label: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s45-0227-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

beforeAll(async () => {
  assertDisposableDatabase();
  admin = knexLib({
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
  if (admin) await admin.destroy();
});

/** Rollback must leave the shared disposable DB at head, RED or GREEN. */
async function expectHeadRestored(): Promise<void> {
  await asAdminRolledBack(async (trx) => {
    expect(await schema0227(trx)).toEqual(HEAD);
  });
}

describe('S4-5-I1 — migration 0227 held recovery foundation', () => {
  it('F1 — head carries every 0227 object; sf_app holds only SELECT + INSERT; ledger and truth untouched', async () => {
    await asAdminRolledBack(async (trx) => {
      expect(await schema0227(trx)).toEqual(HEAD);

      const grants = await trx.raw(`
        SELECT p AS privilege, has_table_privilege('sf_app', 'public.receive_held_recovery_events', p) AS granted
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
      `);
      expect(Object.fromEntries(grants.rows.map((r: any) => [r.privilege, r.granted]))).toEqual({
        SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
      });

      const ledgerTriggers = await trx.raw(`
        SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE NOT t.tgisinternal
           AND t.tgrelid IN (to_regclass('public.inventory_movements'), to_regclass('public.inventory_truth'))
           AND p.proname IN ('validate_receive_held_recovery_event', 'prevent_receive_held_recovery_event_mutation',
                             'guard_receive_recovery_stow', 'guard_held_unit_custody', 'guard_receive_task_custody')
      `);
      expect(ledgerTriggers.rows[0].n).toBe(0);
    });
  });

  it('F2 — runtime scenarios execute as restricted sf_app', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const role = await trx.raw(`
        SELECT session_user::text AS s, current_user::text AS u, r.rolsuper, r.rolbypassrls
          FROM pg_roles r WHERE r.rolname = current_user`);
      expect(role.rows[0]).toEqual({ s: 'sf_app', u: 'sf_app', rolsuper: false, rolbypassrls: false });
    });
  });

  it('R1 — recovery: the recovered event authorizes held → stowed, Stow completion and task closure; the unit is then ordinary stock', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [unit] } = await seedPlaced(trx, shopId, 1);

      const stowId = await insertStow(trx, stowRow(shopId, f, unit));
      await claimStow(trx, shopId, stowId);
      await trx('receive_held_recovery_events').insert(
        eventRow(shopId, unit, 'recovered', f.pickBin, { stow_task_id: stowId }));

      const steps = {
        unitStowed: failure(await inSavepoint(trx, (sp) => sp('inventory_units')
          .where({ shop_id: shopId, lasyncro_unit_id: unit.lsu })
          .update({ status: 'stowed', current_location_code: f.pickBin, updated_at: new Date() }))),
        stowCompleted: failure(await inSavepoint(trx, (sp) => sp('stow_tasks')
          .where({ shop_id: shopId, stow_task_id: stowId })
          .update({ status: 'completed', quantity_placed: 1, completed_at: new Date() }))),
        taskResolved: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: unit.taskId })
          .update({ status: 'resolved', resolution_action: 're_stow', resolved_at: new Date() }))),
      };
      expect(steps).toEqual({ unitStowed: null, stowCompleted: null, taskResolved: null });

      const updateUnit = (fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu }).update(fields));
      expect({
        backToHeld: failure(await updateUnit({ status: 'held' })),
        toDiscarded: failure(await updateUnit({ status: 'discarded' })),
        custodyRewritten: failure(await updateUnit({ held_placed_at: new Date(Date.now() + 1000) })),
        taskReopened: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: unit.taskId }).update({ status: 'open' }))),
        stowReopened: failure(await inSavepoint(trx, (sp) => sp('stow_tasks')
          .where({ shop_id: shopId, stow_task_id: stowId }).update({ status: 'in_progress' }))),
        // Positive control: recovered stock follows the ordinary lifecycle.
        picked: failure(await updateUnit({ status: 'picked', current_location_code: null })),
      }).toEqual({
        backToHeld: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        toDiscarded: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        custodyRewritten: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        taskReopened: 'P0001 RECEIVE_HELD_RECOVERY_TASK_FINAL',
        stowReopened: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        picked: null,
      });

      expect({
        unit: await unitState(trx, shopId, unit.lsu),
        stow: await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: stowId }).first('status', 'location_code'),
        task: await trx('problem_center_tasks').where({ shop_id: shopId, problem_task_id: unit.taskId }).first('status'),
        events: await trx('receive_held_recovery_events').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu })
          .select('outcome', 'stow_task_id', 'location_code'),
      }).toEqual({
        unit: { status: 'picked', current_location_code: null, placed: true },
        stow: { status: 'completed', location_code: f.pickBin },
        task: { status: 'resolved' },
        events: [{ outcome: 'recovered', stow_task_id: stowId, location_code: f.pickBin }],
      });
    });
  });

  it('R2 — disposal: the discarded event authorizes held → discarded in place and task closure; both are then final', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [unit] } = await seedPlaced(trx, shopId, 1);

      await trx('receive_held_recovery_events').insert(eventRow(shopId, unit, 'discarded', f.bin));
      const updateUnit = (fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu }).update(fields));

      expect({
        discardMoved: failure(await updateUnit({ status: 'discarded', current_location_code: f.otherBin })),
        discarded: failure(await updateUnit({ status: 'discarded' })),
        taskDiscarded: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: unit.taskId }).update({ status: 'discarded', resolved_at: new Date() }))),
      }).toEqual({ discardMoved: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE', discarded: null, taskDiscarded: null });

      expect({
        revived: failure(await updateUnit({ status: 'stowed', current_location_code: f.pickBin })),
        rereceived: failure(await updateUnit({ status: 'received' })),
        moved: failure(await updateUnit({ current_location_code: f.otherBin })),
        recoveryAfterDisposal: failure(await inSavepoint(trx, (sp) => sp('stow_tasks').insert(stowRow(shopId, f, unit)))),
        taskReopened: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: unit.taskId }).update({ status: 'investigating' }))),
        // Positive control: non-custody columns still update.
        labelled: failure(await updateUnit({ label_printed_at: new Date(), updated_at: new Date() })),
      }).toEqual({
        revived: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        rereceived: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        moved: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        recoveryAfterDisposal: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        taskReopened: 'P0001 RECEIVE_HELD_RECOVERY_TASK_FINAL',
        labelled: null,
      });

      expect(await unitState(trx, shopId, unit.lsu)).toEqual({ status: 'discarded', current_location_code: f.bin, placed: true });
    });
  });

  it('R3 — without an outcome every exit is refused; an outcome authorizes only its own transition', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [bare, recovered, discarded] } = await seedPlaced(trx, shopId, 3);
      const updateUnit = (lsu: string, fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lsu }).update(fields));
      const updateTask = (taskId: string, fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('problem_center_tasks').where({ shop_id: shopId, problem_task_id: taskId }).update(fields));

      const bareStow = await insertStow(trx, stowRow(shopId, f, bare));
      await claimStow(trx, shopId, bareStow);
      const recoveredStow = await insertStow(trx, stowRow(shopId, f, recovered));
      await claimStow(trx, shopId, recoveredStow);
      await trx('receive_held_recovery_events').insert(
        eventRow(shopId, recovered, 'recovered', f.pickBin, { stow_task_id: recoveredStow }));
      await trx('receive_held_recovery_events').insert(eventRow(shopId, discarded, 'discarded', f.bin));

      expect({
        bareStowed: failure(await updateUnit(bare.lsu, { status: 'stowed', current_location_code: f.pickBin })),
        bareDiscarded: failure(await updateUnit(bare.lsu, { status: 'discarded' })),
        bareTaskResolved: failure(await updateTask(bare.taskId, { status: 'resolved' })),
        bareTaskDiscarded: failure(await updateTask(bare.taskId, { status: 'discarded' })),
        bareStowCompleted: failure(await inSavepoint(trx, (sp) => sp('stow_tasks')
          .where({ shop_id: shopId, stow_task_id: bareStow }).update({ status: 'completed' }))),
        recoveredElsewhere: failure(await updateUnit(recovered.lsu, { status: 'stowed', current_location_code: f.otherBin })),
        recoveredDiscarded: failure(await updateUnit(recovered.lsu, { status: 'discarded' })),
        recoveredStowMoved: failure(await inSavepoint(trx, (sp) => sp('stow_tasks')
          .where({ shop_id: shopId, stow_task_id: recoveredStow }).update({ location_code: f.otherBin }))),
        recoveredStowCancelled: failure(await inSavepoint(trx, (sp) => sp('stow_tasks')
          .where({ shop_id: shopId, stow_task_id: recoveredStow }).update({ status: 'cancelled' }))),
        discardedStowed: failure(await updateUnit(discarded.lsu, { status: 'stowed', current_location_code: f.pickBin })),
        // Placement events remain non-transferable: a different custody event set is refused.
        bareHeldPlacedAt: failure(await updateUnit(bare.lsu, { held_placed_at: new Date(Date.now() + 1000) })),
        // Positive control: the task may enter investigation without an outcome.
        bareInvestigating: failure(await updateTask(bare.taskId, { status: 'investigating' })),
      }).toEqual({
        bareStowed: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        bareDiscarded: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        bareTaskResolved: 'P0001 RECEIVE_HELD_RECOVERY_OUTCOME_REQUIRED',
        bareTaskDiscarded: 'P0001 RECEIVE_HELD_RECOVERY_OUTCOME_REQUIRED',
        bareStowCompleted: 'P0001 RECEIVE_RECOVERY_STOW_OUTCOME_REQUIRED',
        recoveredElsewhere: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        recoveredDiscarded: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        recoveredStowMoved: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        recoveredStowCancelled: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        discardedStowed: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        bareHeldPlacedAt: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        bareInvestigating: null,
      });

      for (const unit of [bare, recovered, discarded]) {
        expect(await unitState(trx, shopId, unit.lsu)).toEqual({ status: 'held', current_location_code: f.bin, placed: true });
      }
    });
  });

  it('R4 — one outcome per LSU, task and device event; one live recovery Stow per task; no disposal while one is live', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [unit, second, third, fourth] } = await seedPlaced(trx, shopId, 4);

      const firstEvent = eventRow(shopId, unit, 'discarded', f.bin);
      await trx('receive_held_recovery_events').insert(firstEvent);

      const liveStow = await insertStow(trx, stowRow(shopId, f, second));
      for (const cancelled of [third, fourth]) {
        const stowId = await insertStow(trx, stowRow(shopId, f, cancelled));
        await trx('stow_tasks').where({ shop_id: shopId, stow_task_id: stowId }).update({ status: 'cancelled' });
      }

      expect({
        secondOutcomeSameUnit: failure(await inSavepoint(trx, (sp) => sp('receive_held_recovery_events')
          .insert(eventRow(shopId, unit, 'discarded', f.bin)))),
        sameDeviceEvent: failure(await inSavepoint(trx, (sp) => sp('receive_held_recovery_events')
          .insert(eventRow(shopId, third, 'discarded', f.bin, { device_event_id: firstEvent.device_event_id })))),
        secondLiveStow: failure(await inSavepoint(trx, (sp) => sp('stow_tasks').insert(stowRow(shopId, f, second)))),
        discardWhileStowLive: failure(await inSavepoint(trx, (sp) => sp('receive_held_recovery_events')
          .insert(eventRow(shopId, second, 'discarded', f.bin)))),
        // Positive controls: a cancelled recovery Stow is history, not a blocker.
        replacementAfterCancel: failure(await inSavepoint(trx, (sp) => sp('stow_tasks').insert(stowRow(shopId, f, third)))),
        discardAfterCancel: failure(await inSavepoint(trx, (sp) => sp('receive_held_recovery_events')
          .insert(eventRow(shopId, fourth, 'discarded', f.bin)))),
      }).toEqual({
        secondOutcomeSameUnit: '23505 duplicate key',
        sameDeviceEvent: '23505 duplicate key',
        secondLiveStow: '23505 duplicate key',
        discardWhileStowLive: 'P0001 RECEIVE_HELD_RECOVERY_STOW_ACTIVE',
        replacementAfterCancel: null,
        discardAfterCancel: null,
      });

      expect(await trx('stow_tasks').where({ shop_id: shopId, trigger: 'receive_recovery', source_task_id: second.taskId })
        .pluck('stow_task_id')).toEqual([liveStow]);
    });
  });

  it('R5 — invalid custody, Receive state, Stow shape and Stow identity changes are refused', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const open = await seedPlaced(trx, shopId, 1, false);
      const { f, units: [unit, other] } = await seedPlaced(trx, shopId, 2);
      const unplaced = await seedHeldUnit(trx, shopId, f, 3);
      const ordinaryLsu = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId, lasyncro_unit_id: ordinaryLsu, lasyncro_variant_id: f.variantId,
        receive_job_line_id: f.receiveJobLineId, receive_sequence: 4, status: 'received',
      });

      const pendingStow = await insertStow(trx, stowRow(shopId, f, other));
      const insertEvent = (row: Record<string, unknown>) => inSavepoint(trx, (sp) => sp('receive_held_recovery_events').insert(row));
      const insertStowRow = (row: Record<string, unknown>) => inSavepoint(trx, (sp) => sp('stow_tasks').insert(row));
      const updateStow = (fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('stow_tasks').where({ shop_id: shopId, stow_task_id: pendingStow }).update(fields));

      expect({
        eventReceiveOpen: failure(await insertEvent(eventRow(shopId, open.units[0], 'discarded', open.f.bin))),
        stowReceiveOpen: failure(await insertStowRow(stowRow(shopId, open.f, open.units[0]))),
        eventUnplaced: failure(await insertEvent(eventRow(shopId, unplaced, 'discarded', f.bin))),
        stowUnplaced: failure(await insertStowRow(stowRow(shopId, f, unplaced))),
        eventOrdinaryUnit: failure(await insertEvent(eventRow(shopId, { lsu: ordinaryLsu, taskId: unit.taskId }, 'discarded', f.bin))),
        eventForeignTask: failure(await insertEvent(eventRow(shopId, { lsu: unit.lsu, taskId: other.taskId }, 'discarded', f.bin))),
        discardElsewhere: failure(await insertEvent(eventRow(shopId, unit, 'discarded', f.otherBin))),
        recoveredWithoutStow: failure(await insertEvent(eventRow(shopId, unit, 'recovered', f.pickBin))),
        discardedWithStow: failure(await insertEvent(eventRow(shopId, unit, 'discarded', f.bin, { stow_task_id: pendingStow }))),
        recoveredPendingStow: failure(await insertEvent(eventRow(shopId, other, 'recovered', f.pickBin, { stow_task_id: pendingStow }))),
        stowNoSource: failure(await insertStowRow(stowRow(shopId, f, unit, { source_task_id: null }))),
        stowQuantityTwo: failure(await insertStowRow(stowRow(shopId, f, unit, { quantity: 2 }))),
        stowBornInProgress: failure(await insertStowRow(stowRow(shopId, f, unit, { status: 'in_progress' }))),
        stowIntoCustodyBin: failure(await insertStowRow(stowRow(shopId, f, unit, { location_code: f.bin }))),
        stowWrongVariant: failure(await insertStowRow(stowRow(shopId, f, unit, { lasyncro_variant_id: open.f.variantId }))),
        stowSourceChanged: failure(await updateStow({ source_task_id: unit.taskId })),
        stowQuantityChanged: failure(await updateStow({ quantity: 2 })),
        stowTriggerChanged: failure(await updateStow({ trigger: 'problem_center' })),
        // Positive control: assignment of the destination before claim is allowed.
        stowReassigned: failure(await updateStow({ location_code: f.otherBin })),
      }).toEqual({
        eventReceiveOpen: 'P0001 RECEIVE_HELD_RECOVERY_RECEIVE_NOT_CLOSED',
        stowReceiveOpen: 'P0001 RECEIVE_HELD_RECOVERY_RECEIVE_NOT_CLOSED',
        eventUnplaced: 'P0001 RECEIVE_HELD_RECOVERY_UNIT_INVALID',
        stowUnplaced: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        eventOrdinaryUnit: 'P0001 RECEIVE_HELD_RECOVERY_UNIT_INVALID',
        eventForeignTask: 'P0001 RECEIVE_HELD_RECOVERY_CUSTODY_INVALID',
        discardElsewhere: 'P0001 RECEIVE_HELD_RECOVERY_DISCARD_LOCATION_INVALID',
        // The BEFORE INSERT validator refuses before the shape CHECK is evaluated.
        recoveredWithoutStow: 'P0001 RECEIVE_HELD_RECOVERY_STOW_INVALID',
        discardedWithStow: '23514 check constraint',
        recoveredPendingStow: 'P0001 RECEIVE_HELD_RECOVERY_STOW_INVALID',
        stowNoSource: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        stowQuantityTwo: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        stowBornInProgress: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        stowIntoCustodyBin: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        stowWrongVariant: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        stowSourceChanged: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        stowQuantityChanged: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        stowTriggerChanged: 'P0001 RECEIVE_RECOVERY_STOW_IMMUTABLE',
        stowReassigned: null,
      });

      expect(await trx('receive_held_recovery_events').where({ shop_id: shopId })
        .whereIn('lasyncro_unit_id', [unit.lsu, other.lsu, unplaced.lsu, open.units[0].lsu]).count<{ n: string }[]>({ n: '*' }))
        .toEqual([{ n: '0' }]);
    });
  });

  it('R5b — non-recovery Stows and the migration role are unaffected by the recovery guard', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const f = await seedLine(trx, shopId);
      const outcome = await inSavepoint(trx, async (sp) => {
        const stowId = await insertStow(sp, {
          shop_id: shopId, lasyncro_variant_id: f.variantId, quantity: 2, status: 'pending',
          trigger: 'return_restock', location_code: f.pickBin,
        });
        await sp('stow_tasks').where({ shop_id: shopId, stow_task_id: stowId })
          .update({ status: 'in_progress', quantity: 3, location_code: f.otherBin });
      });
      expect(outcome).toEqual({ ok: true });
    });
    await asAdminRolledBack(async (trx) => {
      const f = await seedLine(trx, shopId);
      // 0224 rollback-evidence shape: maintenance roles keep authority.
      const outcome = await inSavepoint(trx, (sp) => sp('stow_tasks').insert({
        shop_id: shopId, lasyncro_variant_id: f.variantId, quantity: 1, status: 'pending', trigger: 'receive_recovery',
      }));
      expect(outcome).toEqual({ ok: true });
    });
  });

  it('R6 — tenant isolation: another shop sees no events and cannot write events or recovery Stows for the owner', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [unit, second] } = await seedPlaced(trx, shopId, 2);
      const event = eventRow(shopId, unit, 'discarded', f.bin);
      await trx('receive_held_recovery_events').insert(event);

      const visible = () => trx('receive_held_recovery_events')
        .where({ device_event_id: event.device_event_id }).count<{ n: string }[]>({ n: '*' });
      await asTenant(trx, shopId);
      const owner = Number((await visible())[0].n);
      await asTenant(trx, otherShopId);
      const stranger = Number((await visible())[0].n);
      const crossEvent = failure(await inSavepoint(trx, (sp) => sp('receive_held_recovery_events')
        .insert(eventRow(shopId, second, 'discarded', f.bin))));
      const crossStowAsOwner = failure(await inSavepoint(trx, (sp) => sp('stow_tasks').insert(stowRow(shopId, f, second))));
      const crossStowAsStranger = failure(await inSavepoint(trx, (sp) => sp('stow_tasks').insert(stowRow(otherShopId, f, second))));
      await asTenant(trx, shopId);

      // Under the other tenant the owner's unit and task are invisible to the
      // insert triggers, which refuse before RLS WITH CHECK (proven present in F1).
      expect({ owner, stranger, crossEvent, crossStowAsOwner, crossStowAsStranger }).toEqual({
        owner: 1,
        stranger: 0,
        crossEvent: 'P0001 RECEIVE_HELD_RECOVERY_UNIT_INVALID',
        crossStowAsOwner: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
        crossStowAsStranger: 'P0001 RECEIVE_RECOVERY_STOW_SOURCE_INVALID',
      });
    });
  });

  it('R7 — events are append-only for sf_app (no privilege) and the migration role (trigger)', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const { f, units: [unit] } = await seedPlaced(trx, shopId, 1);
      const event = eventRow(shopId, unit, 'discarded', f.bin);
      await trx('receive_held_recovery_events').insert(event);
      const target = (sp: Knex.Transaction) =>
        sp('receive_held_recovery_events').where({ shop_id: shopId, device_event_id: event.device_event_id });
      expect({
        updated: failure(await inSavepoint(trx, (sp) => target(sp).update({ location_code: f.otherBin }))),
        deleted: failure(await inSavepoint(trx, (sp) => target(sp).del())),
      }).toEqual({ updated: '42501 permission denied', deleted: '42501 permission denied' });
    });
    await asAdminRolledBack(async (trx) => {
      const { f, units: [unit] } = await seedPlaced(trx, shopId, 1);
      const event = eventRow(shopId, unit, 'discarded', f.bin);
      await trx('receive_held_recovery_events').insert(event);
      const target = (sp: Knex.Transaction) =>
        sp('receive_held_recovery_events').where({ shop_id: shopId, device_event_id: event.device_event_id });
      expect({
        updated: failure(await inSavepoint(trx, (sp) => target(sp).update({ location_code: f.otherBin }))),
        deleted: failure(await inSavepoint(trx, (sp) => target(sp).del())),
      }).toEqual({ updated: 'P0001 append-only', deleted: 'P0001 append-only' });
    });
  });

  it('M1 — without 0227 evidence: DOWN restores the exact 0226 guards and DOWN → UP round-trips the schema', async () => {
    try {
      await asAdminRolledBack(async (trx) => {
        expect(await schema0227(trx)).toEqual(HEAD);
        expect(await inSavepoint(trx, (sp) => migration0227.down(sp))).toEqual({ ok: true });
        expect(await schema0227(trx)).toEqual(PRE_0227);

        // The restored bodies equal what 0226 itself installs. 0226's own
        // definitions are re-applied in place: 0226 DOWN fails closed once any
        // suite has committed custody evidence, so it is not a usable oracle.
        const restored = await guardSources(trx);
        const definitions = await guardDefinitions0226();
        expect(definitions.map(([name]) => name)).toEqual(['guard_held_unit_custody', 'guard_receive_task_custody']);
        expect(await inSavepoint(trx, async (sp) => {
          for (const [, sql] of definitions) await sp.raw(sql);
          expect(await guardSources(sp)).toEqual(restored);
        })).toEqual({ ok: true });

        expect(await inSavepoint(trx, (sp) => migration0227.up(sp))).toEqual({ ok: true });
        expect(await schema0227(trx)).toEqual(HEAD);
      });
    } finally {
      await expectHeadRestored();
    }
  });

  it.each(['recovery_event', 'recovery_stow'] as const)(
    'M2 — DOWN refuses with %s evidence, leaving the 0227 schema in place',
    async (kind) => {
      try {
        await asAdminRolledBack(async (trx) => {
          const { f, units: [unit] } = await seedPlaced(trx, shopId, 1);
          if (kind === 'recovery_event') {
            await trx('receive_held_recovery_events').insert(eventRow(shopId, unit, 'discarded', f.bin));
          } else {
            await insertStow(trx, stowRow(shopId, f, unit));
          }
          const outcome = await inSavepoint(trx, (sp) => migration0227.down(sp));
          expect(outcome.ok).toBe(false);
          expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_HELD_RECOVERY_ROLLBACK_BLOCKED/);
          expect(await schema0227(trx)).toEqual(HEAD);
        });
      } finally {
        await expectHeadRestored();
      }
    },
  );
});
