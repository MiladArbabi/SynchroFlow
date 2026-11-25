import crypto from 'crypto';
import knexLib from 'knex';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import { issueTestToken } from '../../unit/helpers/auth';
import db, { setTenantContext, systemTransaction, withTenant } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { resolveShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { claimStowTask, confirmStow } from 'api-src/services/wms/stow.service';
import { quarantineUnitToProblemBin } from 'api-src/services/inventory/problemBinQuarantine.service';
jest.setTimeout(180000);

/**
 * SCAN-ACT-01 RC-01 — RED contract for the authoritative Problem Bin operation
 * outcome read (MiladArbabi/SynchroFlow#1328).
 *
 *   GET /api/v1/wms/problem-bin/operations/:deviceEventId/outcome
 *
 *   recorded   — a durable committed receipt (problem_bin_custody_events)
 *                attributable to this exact operation and caller exists:
 *                { status, operation_identity, operator_id, result }
 *   unresolved — an authoritative committed outcome cannot be established:
 *                { status, operation_identity }. Absence is never proof that
 *                nothing committed; there is no not_committed state.
 *
 * Fixture conventions are reused from tests/integration/wms/problem-bin-quarantine.test.ts
 * (shop/user bootstrap, GH-1305 S3A inbound seed, stow-to-bin, token issue,
 * state snapshot). Preconditions throw PRECONDITION_FAILED so a fixture failure
 * is never mistaken for contract RED.
 */
const BIN = 'CAP-1';
const PROBLEM = 'PROBLEM-S2';
const FLAG = 'PROBLEM_BIN_QUARANTINE_ENABLED';
const OUTCOME = (deviceEventId: string) => `/api/v1/wms/problem-bin/operations/${deviceEventId}/outcome`;

function precondition(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`PRECONDITION_FAILED: ${what}`);
}

async function createShopWithUser(prefix: string, role: 'operator' | 'owner' = 'operator') {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${prefix}-${unique}`);
    await setTenantContext(trx, id);
    await trx('shop_wms_settings')
      .insert({ shop_id: id, bootstrap_model: 'reconcile_opening_expectation_v2' })
      .onConflict('shop_id').ignore();
    return id;
  });
  const operatorId = await addUser(shopId, prefix, role);
  return { shopId, operatorId };
}

async function addUser(shopId: number, prefix: string, role: 'operator' | 'owner' = 'operator') {
  const unique = crypto.randomBytes(6).toString('hex');
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({ shop_id: shopId, email: `${prefix}-${role}-${unique}@test.example`, password_hash: 'not_a_real_hash',
        first_name: 'Problem', last_name: 'Bin', role })
      .returning('id');
    const id = Number((row as any).id ?? row);
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: id, role });
    return id;
  });
}

/** GH-1305 S3A inbound fixture: received LSUs at ROOT plus an inbound Stow task. */
async function seedTask(shopId: number, unitCount: number) {
  return withTenant(shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const rootCode = `WH-${shopId}-ROOT`;
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'Cap product', status: 'active', product_type: 'physical' });
    await trx('variants').insert({ lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `CAP-${variantId.slice(0, 8)}`, title: 'Cap variant', unit_cost: '5.00', status: 'active' });
    await trx('warehouses')
      .insert({ warehouse_id: crypto.randomUUID(), shop_id: shopId, name: `Cap wh ${crypto.randomUUID().slice(0, 8)}`,
        root_location_code: rootCode, is_default: true, active: true })
      .onConflict(['shop_id', 'root_location_code']).ignore();
    const wh = await trx('warehouses').where({ shop_id: shopId, root_location_code: rootCode }).first('warehouse_id');
    if (!(await trx('warehouse_locations').where({ shop_id: shopId, location_code: rootCode }).first())) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: wh.warehouse_id, location_code: rootCode,
        type: 'warehouse', parent_location_code: null, active: true, zone_type: null });
    }
    if (!(await trx('warehouse_locations').where({ shop_id: shopId, location_code: BIN }).first())) {
      await trx('warehouse_locations').insert({ shop_id: shopId, warehouse_id: wh.warehouse_id, location_code: BIN,
        type: 'bin', parent_location_code: rootCode, active: true, zone_type: 'pick' });
    }
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `Cap supplier ${crypto.randomUUID().slice(0, 8)}`, active: true }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: (supplier as any).id ?? supplier, status: 'shipped' }).returning('id');
    const poId = String((po as any).id ?? po);
    const [poLine] = await trx('purchase_order_line_items').insert({ po_id: poId, shop_id: shopId, lasyncro_variant_id: variantId,
      description: 'Cap PO line', quantity_ordered: unitCount, quantity_received: unitCount }).returning('id');
    const [job] = await trx('receive_jobs').insert({ shop_id: shopId, po_id: poId, status: 'closed', total_variants: 1, total_units: unitCount }).returning('receive_job_id');
    const [line] = await trx('receive_job_lines').insert({ shop_id: shopId, receive_job_id: String((job as any).receive_job_id ?? job),
      po_line_item_id: (poLine as any).id ?? poLine, lasyncro_variant_id: variantId, quantity_expected: unitCount,
      quantity_accepted: unitCount, inspection_complete: true }).returning('receive_job_line_id');
    const receiveJobLineId = String((line as any).receive_job_line_id ?? line);
    const lasyncroUnitIds: string[] = [];
    for (let i = 1; i <= unitCount; i++) {
      const id = `LSU-${crypto.randomUUID().slice(0, 12)}`;
      await trx('inventory_units').insert({ shop_id: shopId, lasyncro_variant_id: variantId, receive_job_line_id: receiveJobLineId,
        receive_sequence: i, status: 'received', current_location_code: null, lasyncro_unit_id: id });
      lasyncroUnitIds.push(id);
    }
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('inventory_truth')
      .insert({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: rootCode, on_hand_quantity: unitCount,
        reserved_quantity: 0, committed_quantity: 0, available_quantity: unitCount, last_evaluated_at: new Date() });
    await trx('inventory_movements').insert({ lasyncro_inventory_movement_id: crypto.randomUUID(), device_event_id: crypto.randomUUID(),
      shop_id: shopId, lasyncro_variant_id: variantId, movement_type: 'inbound_purchase', quantity_delta: unitCount,
      location_code: rootCode, reference_type: 'test_seed', reference_id: crypto.randomUUID(), platform: 'wms',
      triggered_by: 'test_seed', occurred_at: new Date() });
    const [task] = await trx('stow_tasks').insert({ shop_id: shopId, lasyncro_variant_id: variantId, receive_job_line_id: receiveJobLineId,
      quantity: unitCount, location_code: BIN, status: 'pending', trigger: 'inbound_stock', po_id: poId }).returning('stow_task_id');
    return { taskId: String((task as any).stow_task_id ?? task), variantId, lasyncroUnitIds, rootCode };
  });
}

/** Every unit stowed into the pick bin, plus an active Problem Bin (existing suite's setupStowed). */
async function setupStowed(count = 1, prefix = 'rc01-outcome') {
  const shop = await createShopWithUser(prefix);
  const work = await seedTask(shop.shopId, count);
  await withTenant(shop.shopId, (trx) => claimStowTask(trx, work.taskId, shop.shopId, shop.operatorId));
  await withTenant(shop.shopId, async trx => {
    const parent = await trx('warehouse_locations').where({ shop_id: shop.shopId, location_code: BIN }).first();
    await trx('warehouse_locations').insert({ shop_id: shop.shopId, warehouse_id: parent.warehouse_id, location_code: PROBLEM,
      type: 'bin', zone_type: 'problem', active: true, parent_location_code: parent.parent_location_code, max_capacity: 1 });
  });
  const f = { ...shop, ...work };
  for (let i = 0; i < count; i++) {
    await withTenant(f.shopId, async trx => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      return confirmStow(trx, { shopId: f.shopId, stowTaskId: f.taskId, claimedBy: f.operatorId, quantityPlaced: 1, lasyncroUnitId: f.lasyncroUnitIds[i] });
    });
  }
  return f;
}
type Fixture = Awaited<ReturnType<typeof setupStowed>>;

async function tokenFor(shopId: number, userId: number, roles: string[] = ['operator']) {
  await withTenant(shopId, async trx => {
    await trx('user_lifecycle_snapshot').insert({ shop_id: shopId, user_id: userId, phase: 'FT2', since: new Date(), last_event_id: crypto.randomUUID() }).onConflict().ignore();
    await trx('shop_subscriptions').insert({ shop_id: shopId, tier: 'growth', allow_overage: true, billing_provider: 'stripe', stripe_customer_id: null }).onConflict('shop_id').ignore();
  });
  process.env.JWT_SECRET ||= 'test_jwt_secret';
  return issueTestToken({ shopId, userId, tier: 'growth', roles });
}

/** Every write surface the outcome read must never touch. */
async function state(shopId: number) {
  return withTenant(shopId, async trx => ({
    truth: await trx('inventory_truth').where({ shop_id: shopId }).orderBy(['lasyncro_variant_id', 'location_code']),
    units: await trx('inventory_units').where({ shop_id: shopId }).orderBy('lasyncro_unit_id'),
    tasks: await trx('stow_tasks').where({ shop_id: shopId }).orderBy('stow_task_id'),
    movements: await trx('inventory_movements').where({ shop_id: shopId }).orderBy('lasyncro_inventory_movement_id'),
    incidents: await trx('problem_center_tasks').where({ shop_id: shopId }).orderBy('problem_task_id'),
    events: await trx('problem_bin_custody_events').where({ shop_id: shopId }).orderBy('device_event_id'),
    audit: await trx('operator_audit_log').where({ shop_id: shopId }).count({ n: '*' }),
  }));
}

/** Commit one free-scan quarantine through the existing API; returns the 200 body. */
async function commitQuarantine(app: ReturnType<typeof createApp>, f: Fixture, token: string, deviceEventId: string) {
  const res = await request(app).post('/api/v1/wms/problem-bin/quarantine').set('Authorization', `Bearer ${token}`)
    .send({ lasyncro_unit_id: f.lasyncroUnitIds[0], problem_bin_location: PROBLEM, quarantine_reason: 'routine', device_event_id: deviceEventId });
  precondition(res.status === 200 && res.body?.replayed === false, `free-scan quarantine committed (got ${res.status} ${JSON.stringify(res.body)})`);
  return res.body;
}
const receipt = (f: Fixture, deviceEventId: string) => withTenant(f.shopId, trx =>
  trx('problem_bin_custody_events').where({ shop_id: f.shopId, device_event_id: deviceEventId }).first());
const unresolved = (deviceEventId: string) => ({ status: 'unresolved', operation_identity: deviceEventId });

const savedFlag = process.env[FLAG];
afterAll(async () => { if (savedFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = savedFlag; await db.destroy(); });
beforeEach(() => { process.env[FLAG] = 'true'; });

describe('SCAN-ACT-01 RC-01 — Problem Bin operation outcome (RED)', () => {
  it('RED-01 recorded: committed free-scan quarantine reads back as recorded, attributable, with zero writes', async () => {
    const app = createApp(); const f = await setupStowed(); const token = await tokenFor(f.shopId, f.operatorId);
    const deviceEventId = crypto.randomUUID();
    const committed = await commitQuarantine(app, f, token, deviceEventId);
    const row = await receipt(f, deviceEventId);
    precondition(row && row.operator_id === f.operatorId, 'custody receipt persisted for this operation and actor');
    const before = await state(f.shopId);

    const out = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${token}`);

    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ status: 'recorded', operation_identity: deviceEventId, operator_id: row.operator_id });
    expect(out.body.result).toEqual(row.result);
    expect(out.body.result).toMatchObject({ problem_task_id: committed.problem_task_id, lasyncro_unit_id: f.lasyncroUnitIds[0],
      problem_bin_location: PROBLEM, source_location: BIN, context: 'free_scan', quarantine_reason: 'routine' });
    expect(await state(f.shopId)).toEqual(before);
  });

  it('RED-02 unresolved: a valid UUID with no committed receipt is unresolved, never a failure claim', async () => {
    const app = createApp(); const f = await setupStowed(); const token = await tokenFor(f.shopId, f.operatorId);
    const deviceEventId = crypto.randomUUID();
    precondition(!(await receipt(f, deviceEventId)), 'no receipt exists for the fresh UUID');
    const before = await state(f.shopId);

    const out = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${token}`);

    expect(out.status).toBe(200);
    expect(out.body).toEqual(unresolved(deviceEventId)); // exact: no result, no not_committed, no retry hint
    expect(await state(f.shopId)).toEqual(before);
  });

  it('RED-03 isolation: other actors and tenants get the unknown-UUID response; unauthorized callers stay 401/403', async () => {
    const app = createApp(); const f = await setupStowed(); const ownerToken = await tokenFor(f.shopId, f.operatorId);
    const deviceEventId = crypto.randomUUID();
    const committed = await commitQuarantine(app, f, ownerToken, deviceEventId);
    const sameShopActor = await addUser(f.shopId, 'rc01-other-actor');
    const otherActorToken = await tokenFor(f.shopId, sameShopActor);
    const other = await createShopWithUser('rc01-other-tenant');
    const otherTenantToken = await tokenFor(other.shopId, other.operatorId);
    // AUTH-ADMISSION-01: current membership, not the JWT roles claim, decides a
    // shop_user's role. The unauthorized caller is therefore a real user of this
    // shop with NO active membership, carrying an operator claim it cannot use.
    const nonMember = await withTenant(f.shopId, async (trx) => {
      const [row] = await trx('users')
        .insert({ shop_id: f.shopId, email: `rc01-non-member-${crypto.randomBytes(6).toString('hex')}@test.example`,
          password_hash: 'not_a_real_hash', first_name: 'Problem', last_name: 'Bin', role: 'operator' })
        .returning('id');
      return Number((row as any).id ?? row);
    });
    const nonMemberRows = await withTenant(f.shopId, trx => trx('shop_memberships').where({ shop_id: f.shopId, user_id: nonMember }).count({ n: '*' }));
    precondition(Number(nonMemberRows[0].n) === 0 && (await resolveShopContextForUser(nonMember)) === null,
      'non-member user exists in the shop with no active membership (authoritative resolver returns null)');
    const noRoleToken = await tokenFor(f.shopId, nonMember, ['operator']);
    const before = await state(f.shopId);

    // Positive control: the route must exist and serve its owner, so a later
    // 404 can never be mistaken for access control (an absent route 404s for all).
    const own = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${ownerToken}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ status: 'recorded', operation_identity: deviceEventId });

    // Raw shop-id digits could collide with the echoed UUID, so tenant disclosure is checked by key.
    const secrets = [f.lasyncroUnitIds[0], committed.problem_task_id, PROBLEM, BIN, '"shop_id"', '"operator_id"', '"result"'];
    for (const [who, token] of [['same-shop actor', otherActorToken], ['other tenant', otherTenantToken]] as const) {
      const res = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${token}`);
      expect({ who, status: res.status, body: res.body }).toEqual({ who, status: 200, body: unresolved(deviceEventId) });
      for (const s of secrets) expect({ who, leaked: JSON.stringify(res.body).includes(s) ? s : null }).toEqual({ who, leaked: null });
    }
    expect((await request(app).get(OUTCOME(deviceEventId))).status).toBe(401);
    expect((await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${noRoleToken}`)).status).toBe(403);
    expect(await state(f.shopId)).toEqual(before);
  });

  it('RED-04 flag off: a receipt committed while enabled stays readable after the write flag is disabled', async () => {
    const app = createApp(); const f = await setupStowed(); const token = await tokenFor(f.shopId, f.operatorId);
    const deviceEventId = crypto.randomUUID();
    await commitQuarantine(app, f, token, deviceEventId);
    const row = await receipt(f, deviceEventId);
    precondition(row, 'custody receipt persisted while the flag was enabled');
    delete process.env[FLAG];
    try {
      const status = await request(app).get('/api/v1/wms/problem-bin/status').set('Authorization', `Bearer ${token}`);
      precondition(status.status === 200 && status.body?.enabled === false, `write flag is disabled (got ${status.status} ${JSON.stringify(status.body)})`);

      const out = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${token}`);

      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ status: 'recorded', operation_identity: deviceEventId, operator_id: row.operator_id });
      expect(out.body.result).toEqual(row.result);
    } finally {
      process.env[FLAG] = 'true';
    }
  });

  it('RED-05 in flight: uncommitted receipt evidence on another connection reads unresolved; rollback leaves nothing', async () => {
    const appUrl = process.env.APP_DATABASE_URL ?? '';
    const parsed = new URL(appUrl);
    precondition(decodeURIComponent(parsed.username) === 'sf_app' && /^synchroflow_test_[A-Za-z0-9_]+$/.test(parsed.pathname.slice(1))
      && parsed.pathname.slice(1) === process.env.PGDATABASE, 'writer connection is the restricted sf_app role on the disposable test DB');
    const app = createApp(); const f = await setupStowed(); const token = await tokenFor(f.shopId, f.operatorId);
    const deviceEventId = crypto.randomUUID();
    const before = await state(f.shopId);

    const writer = knexLib({ client: 'pg', connection: appUrl, pool: { min: 0, max: 1 } });
    const trx = await writer.transaction();
    let out: request.Response | undefined; let readError: unknown;
    try {
      await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [String(f.shopId)]);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await quarantineUnitToProblemBin(trx, { shopId: f.shopId, actorId: f.operatorId, lasyncroUnitId: f.lasyncroUnitIds[0],
        problemBinScan: PROBLEM, deviceEventId, quarantineReason: 'routine' });
      const inside = await trx('problem_bin_custody_events').where({ shop_id: f.shopId, device_event_id: deviceEventId }).first();
      precondition(inside && inside.operator_id === f.operatorId, 'valid custody evidence exists inside the open transaction');
      const writerPid = (await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const readerView = await withTenant(f.shopId, async t => ({
        pid: (await t.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        user: (await t.raw('SELECT current_user AS u')).rows[0].u,
        row: await t('problem_bin_custody_events').where({ shop_id: f.shopId, device_event_id: deviceEventId }).first(),
      }));
      precondition(readerView.pid !== writerPid && readerView.user === 'sf_app' && !readerView.row,
        'a second restricted connection cannot see the uncommitted receipt');

      try {
        out = await request(app).get(OUTCOME(deviceEventId)).set('Authorization', `Bearer ${token}`).timeout({ response: 15000, deadline: 20000 });
      } catch (e) { readError = e; }
    } finally {
      await trx.rollback().catch(() => undefined);
      await writer.destroy();
    }

    // Rollback proof first, so contract RED below never hides a persistent effect.
    expect(await state(f.shopId)).toEqual(before);
    expect(readError).toBeUndefined();
    expect(out?.status).toBe(200);
    expect(out?.body).toEqual(unresolved(deviceEventId));
  });
});
