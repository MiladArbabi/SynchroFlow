// S8-C5 / S4-4 — migration 0226 held custody events.
//
//   F1 head carries every 0226 object: keys, FKs, triggers, forced RLS; sf_app
//      holds exactly SELECT + INSERT on the event table; no inventory-credit
//      table gains a 0226 trigger.
//   F2 the runtime role is restricted (sf_app, not superuser, no BYPASSRLS).
//   C1 placement: one event per device_event_id, one placement per held LSU
//      and per task; the one matching unit/task transition is accepted.
//   C2 confirmed custody is immutable: unit status/location/held_placed_at,
//      task bin and task unit identity; events are append-only. Non-custody
//      updates on the same rows still pass.
//   C3 custody cannot be declared without a matching event; invalid events
//      (unit not held, foreign task, foreign or unknown bin) are refused.
//      Ordinary non-held unit updates are unaffected.
//   C4 tenant isolation: owning shop sees its event, another shop sees none
//      and cannot write one for the owning shop.
//   M1 without 0226 evidence, DOWN → UP round-trips the schema.
//   M2 DOWN refuses while any custody event exists, leaving the schema.
//
// MECHANISM (precedent: receive-recoverable-foundation-0224-migration-safety)
//   The harness migrates the disposable DB to head. Every scenario runs in its
//   OWN transaction that is ALWAYS rolled back — migration-role scenarios via
//   `admin`, runtime scenarios via withTenant (sf_app). Probes settle inside
//   savepoints. Nothing is committed except the two tenant shops, so no
//   custody evidence can leak into other suites' rollback checks.

import crypto from 'crypto';
import knexLib, { Knex } from 'knex';

import { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

import * as migration0226 from
  '../../../apps/backend/migrations/20261029120000_0226_receive_held_custody_events';

jest.setTimeout(120000);

let admin: Knex;
let shopId: number;
let otherShopId: number;

function assertDisposableDatabase(): void {
  const name = process.env.PGDATABASE ?? '';
  if (!/^synchroflow_test_[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `S4-4 0226 migration safety refuses to run: PGDATABASE="${name}" is not a ` +
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

const failureCode = (outcome: { ok: boolean; error?: any }) => (outcome.ok ? null : outcome.error?.code ?? 'NO_CODE');
const failure = (outcome: { ok: boolean; error?: any }) =>
  (outcome.ok ? null : `${outcome.error?.code ?? 'NO_CODE'} ${String(outcome.error?.message ?? '').match(/RECEIVE_HELD_CUSTODY_[A-Z_]+|append-only|permission denied|row-level security|foreign key|duplicate key/)?.[0] ?? ''}`.trim());

/** Every 0226-owned object that DOWN removes. */
async function schema0226(trx: Knex.Transaction) {
  const r = await trx.raw(`
    SELECT
      to_regclass('public.receive_held_custody_events') IS NOT NULL AS events_table,
      to_regclass('public.inventory_units_shop_unit_unique') IS NOT NULL AS unit_index,
      to_regclass('public.problem_center_tasks_shop_task_unique') IS NOT NULL AS task_index,
      (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
        WHERE conrelid = to_regclass('public.receive_held_custody_events')) AS constraints,
      (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
        WHERE NOT tgisinternal AND tgname IN (
          'receive_held_custody_events_validate', 'receive_held_custody_events_no_update',
          'receive_held_custody_events_no_delete', 'inventory_units_guard_held_custody',
          'problem_center_tasks_guard_receive_custody')) AS triggers,
      (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
        WHERE oid = to_regclass('public.receive_held_custody_events')) AS forced_rls,
      (SELECT count(*)::int FROM pg_policies
        WHERE tablename = 'receive_held_custody_events'
          AND policyname = 'receive_held_custody_events_tenant_isolation_policy'
          AND qual IS NOT NULL AND with_check IS NOT NULL) AS policy
  `);
  return r.rows[0];
}

const HEAD = {
  events_table: true,
  unit_index: true,
  task_index: true,
  constraints: [
    'receive_held_custody_events_location_fk',
    'receive_held_custody_events_pkey',
    'receive_held_custody_events_shop_id_fkey',
    'receive_held_custody_events_task_fk',
    'receive_held_custody_events_task_unique',
    'receive_held_custody_events_unit_fk',
    'receive_held_custody_events_unit_unique',
  ],
  triggers: [
    'inventory_units_guard_held_custody',
    'problem_center_tasks_guard_receive_custody',
    'receive_held_custody_events_no_delete',
    'receive_held_custody_events_no_update',
    'receive_held_custody_events_validate',
  ],
  forced_rls: true,
  policy: 1,
};
const PRE_0226 = {
  events_table: false,
  unit_index: false,
  task_index: false,
  constraints: null,
  triggers: null,
  forced_rls: null,
  policy: 0,
};

interface Fixture {
  variantId: string;
  receiveJobLineId: string;
  bin: string;
  otherBin: string;
}

/**
 * One tenant PO → Receive job → line, a warehouse with two problem bins, all
 * written through `trx` under the given tenant (works for either role).
 */
async function seedLine(trx: Knex.Transaction, shop: number): Promise<Fixture> {
  await asTenant(trx, shop);
  const nonce = crypto.randomBytes(4).toString('hex');
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await trx('products').insert({
    lasyncro_product_id: productId, shop_id: shop, title: 'S4-4 0226 product', status: 'active', product_type: 'physical',
  });
  await trx('variants').insert({
    lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shop,
    sku: `S44-${nonce}`, title: 'S4-4 0226 variant', unit_cost: '1.00', status: 'active',
  });
  const [supplier] = await trx('suppliers').insert({ shop_id: shop, name: `S4-4 0226 ${nonce}` }).returning('id');
  const [po] = await trx('purchase_orders').insert({ shop_id: shop, supplier_id: supplier.id, status: 'shipped' }).returning('id');
  const [poLine] = await trx('purchase_order_line_items').insert({
    po_id: po.id, shop_id: shop, lasyncro_variant_id: variantId, description: 'S4-4 0226 line',
    quantity_ordered: 3, quantity_received: 0, unit_cost_cents: 100,
  }).returning('id');
  const [job] = await trx('receive_jobs').insert({
    shop_id: shop, po_id: po.id, status: 'in_progress', delivery_accounting_version: 2,
  }).returning('receive_job_id');
  const [line] = await trx('receive_job_lines').insert({
    shop_id: shop, receive_job_id: job.receive_job_id, po_line_item_id: poLine.id,
    lasyncro_variant_id: variantId, quantity_expected: 3,
  }).returning('receive_job_line_id');

  const root = `S44-ROOT-${nonce}`;
  const [warehouse] = await trx('warehouses').insert({
    shop_id: shop, name: `S4-4 0226 ${nonce}`, root_location_code: root,
  }).returning('warehouse_id');
  const bin = `S44-PROB-${nonce}-A`;
  const otherBin = `S44-PROB-${nonce}-B`;
  await trx('warehouse_locations').insert([
    { shop_id: shop, warehouse_id: warehouse.warehouse_id, location_code: root, type: 'warehouse', parent_location_code: null, active: true },
    ...[bin, otherBin].map((location_code) => ({
      shop_id: shop, warehouse_id: warehouse.warehouse_id, location_code, type: 'bin', parent_location_code: root, active: true,
    })),
  ]);
  return { variantId, receiveJobLineId: line.receive_job_line_id, bin, otherBin };
}

/** A held LSU plus its quantity-1 Receive task (the S4-3B shape). */
async function seedHeldUnit(trx: Knex.Transaction, shop: number, f: Fixture, sequence: number) {
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

const eventRow = (shop: number, unit: { lsu: string; taskId: string }, location: string, fields: Record<string, unknown> = {}) => ({
  shop_id: shop,
  device_event_id: crypto.randomUUID(),
  lasyncro_unit_id: unit.lsu,
  problem_task_id: unit.taskId,
  location_code: location,
  placed_by: null,
  ...fields,
});

/** The S4-4 placement write set: event, then unit and task, one transaction. */
async function place(trx: Knex.Transaction, shop: number, unit: { lsu: string; taskId: string }, location: string, deviceEventId = crypto.randomUUID()) {
  await trx('receive_held_custody_events').insert(eventRow(shop, unit, location, { device_event_id: deviceEventId }));
  await trx('inventory_units').where({ shop_id: shop, lasyncro_unit_id: unit.lsu })
    .update({ held_placed_at: new Date(), current_location_code: location, updated_at: new Date() });
  await trx('problem_center_tasks').where({ shop_id: shop, problem_task_id: unit.taskId })
    .update({ problem_bin_location: location });
  return deviceEventId;
}

async function createShop(label: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `s44-0226-${label}-${unique}`);
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
    expect(await schema0226(trx)).toEqual(HEAD);
  });
}

describe('S4-4 — migration 0226 held custody events', () => {
  it('F1 — head carries every 0226 object; sf_app holds only SELECT + INSERT; inventory credit tables untouched', async () => {
    await asAdminRolledBack(async (trx) => {
      expect(await schema0226(trx)).toEqual(HEAD);

      const grants = await trx.raw(`
        SELECT p AS privilege, has_table_privilege('sf_app', 'public.receive_held_custody_events', p) AS granted
          FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
      `);
      expect(Object.fromEntries(grants.rows.map((r: any) => [r.privilege, r.granted]))).toEqual({
        SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
      });

      const creditTriggers = await trx.raw(`
        SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE NOT t.tgisinternal
           AND t.tgrelid IN (to_regclass('public.inventory_movements'), to_regclass('public.inventory_truth'),
                             to_regclass('public.stow_tasks'), to_regclass('public.receive_jobs'),
                             to_regclass('public.receive_job_lines'))
           AND p.proname IN ('validate_receive_held_custody_event', 'prevent_receive_held_custody_event_mutation',
                             'guard_held_unit_custody', 'guard_receive_task_custody')
      `);
      expect(creditTriggers.rows[0].n).toBe(0);
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

  it('C1 — one event per device_event_id, one placement per LSU and task; the matching transition is accepted', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const f = await seedLine(trx, shopId);
      const unit = await seedHeldUnit(trx, shopId, f, 1);
      const second = await seedHeldUnit(trx, shopId, f, 2);

      const eventId = crypto.randomUUID();
      const first = await inSavepoint(trx, (sp) => place(sp, shopId, unit, f.bin, eventId));
      expect(first).toEqual({ ok: true });

      // `third` has an event but no unit update yet, so the insert trigger
      // still accepts it and the UNIQUE (shop, LSU) constraint is what refuses.
      const third = await seedHeldUnit(trx, shopId, f, 3);
      await trx('receive_held_custody_events').insert(eventRow(shopId, third, f.bin));

      expect({
        sameEvent: failure(await inSavepoint(trx, (sp) => sp('receive_held_custody_events')
          .insert(eventRow(shopId, second, f.bin, { device_event_id: eventId })))),
        unplacedUnitSecondEvent: failure(await inSavepoint(trx, (sp) => sp('receive_held_custody_events')
          .insert(eventRow(shopId, third, f.otherBin)))),
        placedUnitNewEvent: failure(await inSavepoint(trx, (sp) => sp('receive_held_custody_events')
          .insert(eventRow(shopId, unit, f.otherBin)))),
      }).toEqual({
        sameEvent: '23505 duplicate key',
        unplacedUnitSecondEvent: '23505 duplicate key',
        placedUnitNewEvent: 'P0001 RECEIVE_HELD_CUSTODY_UNIT_INVALID',
      });

      const persisted = {
        events: await trx('receive_held_custody_events').where({ shop_id: shopId })
          .whereIn('lasyncro_unit_id', [unit.lsu, second.lsu])
          .select('device_event_id', 'lasyncro_unit_id', 'problem_task_id', 'location_code'),
        unit: await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu })
          .first('status', 'current_location_code', trx.raw('held_placed_at IS NOT NULL AS placed')),
        task: await trx('problem_center_tasks').where({ shop_id: shopId, problem_task_id: unit.taskId })
          .first('problem_bin_location'),
      };
      expect(persisted).toEqual({
        events: [{ device_event_id: eventId, lasyncro_unit_id: unit.lsu, problem_task_id: unit.taskId, location_code: f.bin }],
        unit: { status: 'held', current_location_code: f.bin, placed: true },
        task: { problem_bin_location: f.bin },
      });
    });
  });

  it('C2 — confirmed custody is immutable and events are append-only; non-custody updates still pass', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const f = await seedLine(trx, shopId);
      const unit = await seedHeldUnit(trx, shopId, f, 1);
      const eventId = await place(trx, shopId, unit, f.bin);

      const updateUnit = (fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu }).update(fields));
      const updateTask = (fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('problem_center_tasks').where({ shop_id: shopId, problem_task_id: unit.taskId }).update(fields));
      const event = () => trx('receive_held_custody_events').where({ shop_id: shopId, device_event_id: eventId });

      expect({
        unitRecovered: failure(await updateUnit({ status: 'received' })),
        unitDiscarded: failure(await updateUnit({ status: 'discarded' })),
        unitMoved: failure(await updateUnit({ current_location_code: f.otherBin })),
        unitUnlocated: failure(await updateUnit({ current_location_code: null })),
        unitUnplaced: failure(await updateUnit({ held_placed_at: null })),
        unitReplaced: failure(await updateUnit({ held_placed_at: new Date(Date.now() + 1000) })),
        unitDeleted: failure(await inSavepoint(trx, (sp) =>
          sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu }).del())),
        taskRebinned: failure(await updateTask({ problem_bin_location: f.otherBin })),
        taskUnbinned: failure(await updateTask({ problem_bin_location: null })),
        taskUnitChanged: failure(await updateTask({ lasyncro_unit_id: `LSU-${crypto.randomBytes(4).toString('hex')}` })),
        taskUnitCleared: failure(await updateTask({ lasyncro_unit_id: null })),
        taskSourceChanged: failure(await updateTask({ source: 'pick' })),
        eventUpdated: failure(await inSavepoint(trx, (sp) =>
          sp('receive_held_custody_events').where({ shop_id: shopId, device_event_id: eventId }).update({ location_code: f.otherBin }))),
        eventDeleted: failure(await inSavepoint(trx, (sp) =>
          sp('receive_held_custody_events').where({ shop_id: shopId, device_event_id: eventId }).del())),
        // Positive controls: non-custody columns on the same rows still update.
        unitLabelled: failure(await updateUnit({ label_printed_at: new Date(), updated_at: new Date() })),
        taskNoted: failure(await updateTask({ notes: 'S4-4 note' })),
      }).toEqual({
        unitRecovered: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitDiscarded: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitMoved: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitUnlocated: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitUnplaced: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitReplaced: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        unitDeleted: '23503 foreign key',
        taskRebinned: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        taskUnbinned: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        taskUnitChanged: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        taskUnitCleared: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        taskSourceChanged: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        eventUpdated: '42501 permission denied',
        eventDeleted: '42501 permission denied',
        unitLabelled: null,
        taskNoted: null,
      });

      expect(await event().first('location_code')).toEqual({ location_code: f.bin });
      expect(await trx('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: unit.lsu })
        .first('status', 'current_location_code')).toEqual({ status: 'held', current_location_code: f.bin });
      expect(await trx('problem_center_tasks').where({ shop_id: shopId, problem_task_id: unit.taskId })
        .first('problem_bin_location', 'lasyncro_unit_id')).toEqual({ problem_bin_location: f.bin, lasyncro_unit_id: unit.lsu });
    });
  });

  it('C2b — append-only triggers refuse UPDATE / DELETE for the migration role too', async () => {
    await asAdminRolledBack(async (trx) => {
      const f = await seedLine(trx, shopId);
      const unit = await seedHeldUnit(trx, shopId, f, 1);
      const eventId = await place(trx, shopId, unit, f.bin);
      const target = (sp: Knex.Transaction) =>
        sp('receive_held_custody_events').where({ shop_id: shopId, device_event_id: eventId });
      expect({
        updated: failure(await inSavepoint(trx, (sp) => target(sp).update({ location_code: f.otherBin }))),
        deleted: failure(await inSavepoint(trx, (sp) => target(sp).del())),
      }).toEqual({ updated: 'P0001 append-only', deleted: 'P0001 append-only' });
    });
  });

  it('C3 — custody needs a matching event; invalid events are refused; ordinary units are unaffected', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const f = await seedLine(trx, shopId);
      const loose = await seedHeldUnit(trx, shopId, f, 1);
      const evented = await seedHeldUnit(trx, shopId, f, 2);
      const foreignTask = await seedHeldUnit(trx, shopId, f, 3);
      const ordinaryLsu = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId, lasyncro_unit_id: ordinaryLsu, lasyncro_variant_id: f.variantId,
        receive_job_line_id: f.receiveJobLineId, receive_sequence: 4, status: 'received',
      });
      const other = await (async () => {
        await asTenant(trx, otherShopId);
        const o = await seedLine(trx, otherShopId);
        await asTenant(trx, shopId);
        return o;
      })();

      const updateUnit = (lsu: string, fields: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('inventory_units').where({ shop_id: shopId, lasyncro_unit_id: lsu }).update(fields));
      const insertEvent = (row: Record<string, unknown>) => inSavepoint(trx, (sp) =>
        sp('receive_held_custody_events').insert(row));

      // An event for `evented` at bin A; its unit then tries to move to bin B.
      await trx('receive_held_custody_events').insert(eventRow(shopId, evented, f.bin));

      expect({
        bareHeldPlacedAt: failure(await updateUnit(loose.lsu, { held_placed_at: new Date() })),
        bareHeldLocation: failure(await updateUnit(loose.lsu, { current_location_code: f.bin })),
        bareTaskBin: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: loose.taskId }).update({ problem_bin_location: f.bin }))),
        mismatchedUnitBin: failure(await updateUnit(evented.lsu, { held_placed_at: new Date(), current_location_code: f.otherBin })),
        mismatchedTaskBin: failure(await inSavepoint(trx, (sp) => sp('problem_center_tasks')
          .where({ shop_id: shopId, problem_task_id: evented.taskId }).update({ problem_bin_location: f.otherBin }))),
        eventNotHeld: failure(await insertEvent(eventRow(shopId, { lsu: ordinaryLsu, taskId: loose.taskId }, f.bin))),
        eventForeignTask: failure(await insertEvent(eventRow(shopId, { lsu: loose.lsu, taskId: foreignTask.taskId }, f.bin))),
        eventOtherShopBin: failure(await insertEvent(eventRow(shopId, loose, other.bin))),
        eventUnknownBin: failure(await insertEvent(eventRow(shopId, loose, `S44-NOWHERE-${crypto.randomBytes(3).toString('hex')}`))),
        // Positive controls: an ordinary unit stows; the evented unit takes its own bin.
        ordinaryStowed: failure(await updateUnit(ordinaryLsu, { status: 'stowed', current_location_code: f.bin })),
        matchedUnitBin: failure(await updateUnit(evented.lsu, { held_placed_at: new Date(), current_location_code: f.bin })),
      }).toEqual({
        bareHeldPlacedAt: 'P0001 RECEIVE_HELD_CUSTODY_EVENT_REQUIRED',
        bareHeldLocation: 'P0001 RECEIVE_HELD_CUSTODY_EVENT_REQUIRED',
        bareTaskBin: 'P0001 RECEIVE_HELD_CUSTODY_EVENT_REQUIRED',
        mismatchedUnitBin: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        mismatchedTaskBin: 'P0001 RECEIVE_HELD_CUSTODY_IMMUTABLE',
        eventNotHeld: 'P0001 RECEIVE_HELD_CUSTODY_UNIT_INVALID',
        eventForeignTask: 'P0001 RECEIVE_HELD_CUSTODY_TASK_INVALID',
        eventOtherShopBin: '23503 foreign key',
        eventUnknownBin: '23503 foreign key',
        ordinaryStowed: null,
        matchedUnitBin: null,
      });
    });
  });

  it('C4 — tenant isolation: owner sees its event; another shop sees none and cannot write for the owner', async () => {
    await asRuntimeRolledBack(shopId, async (trx) => {
      const f = await seedLine(trx, shopId);
      const unit = await seedHeldUnit(trx, shopId, f, 1);
      const second = await seedHeldUnit(trx, shopId, f, 2);
      const eventId = await place(trx, shopId, unit, f.bin);

      const visible = () => trx('receive_held_custody_events').where({ device_event_id: eventId }).count<{ n: string }[]>({ n: '*' });
      await asTenant(trx, shopId);
      const owner = Number((await visible())[0].n);
      await asTenant(trx, otherShopId);
      const stranger = Number((await visible())[0].n);
      const crossWrite = failure(await inSavepoint(trx, (sp) =>
        sp('receive_held_custody_events').insert(eventRow(shopId, second, f.bin))));
      await asTenant(trx, shopId);

      // The cross-tenant insert is refused before RLS WITH CHECK is reached:
      // under the other tenant the owner's held unit is invisible to the
      // insert trigger. The WITH CHECK clause itself is proven present in F1.
      expect({ owner, stranger, crossWrite }).toEqual({
        owner: 1, stranger: 0, crossWrite: 'P0001 RECEIVE_HELD_CUSTODY_UNIT_INVALID',
      });
    });
  });

  it('M1 — without 0226 evidence: DOWN → UP round-trips the schema', async () => {
    try {
      await asAdminRolledBack(async (trx) => {
        expect(await schema0226(trx)).toEqual(HEAD);
        expect(await inSavepoint(trx, (sp) => migration0226.down(sp))).toEqual({ ok: true });
        expect(await schema0226(trx)).toEqual(PRE_0226);
        expect(await inSavepoint(trx, (sp) => migration0226.up(sp))).toEqual({ ok: true });
        expect(await schema0226(trx)).toEqual(HEAD);
      });
    } finally {
      await expectHeadRestored();
    }
  });

  it('M2 — DOWN refuses while a custody event exists, leaving the 0226 schema in place', async () => {
    try {
      await asAdminRolledBack(async (trx) => {
        const f = await seedLine(trx, shopId);
        const unit = await seedHeldUnit(trx, shopId, f, 1);
        await place(trx, shopId, unit, f.bin);
        const outcome = await inSavepoint(trx, (sp) => migration0226.down(sp));
        expect(outcome.ok).toBe(false);
        expect(String((outcome as any).error?.message)).toMatch(/RECEIVE_HELD_CUSTODY_ROLLBACK_BLOCKED/);
        expect(await schema0226(trx)).toEqual(HEAD);
      });
    } finally {
      await expectHeadRestored();
    }
  });
});
