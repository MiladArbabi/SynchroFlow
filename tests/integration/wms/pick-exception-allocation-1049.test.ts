/** GH-1049 permanent RED suite. Real release/claim/scan; disposable DB only.
 * Report-time short-pick quantities are observational, never physical picks.
 * Downstream assertions intentionally follow the currently blocked report boundary.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemQuery, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';


const app = createApp();
jest.setTimeout(120000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (same pattern as release-readiness.test.ts) ────────────────

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app)
    .get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value',
      [`shopify-install+${shopDomain}@lasyncro.internal`])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

/** Install → seed healthy reviewer-shaped data → drive the ladder to FT2. */
async function provisionFt2Shop(label: string): Promise<{ shopId: number; userId: number; token: string }> {
  const shopDomain = `rrc-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED', updated_at: new Date(),
    })
  );
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt2?.phase).toBe('FT2');
  return { shopId, userId, token };
}

function postRelease(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`).send(body);
}

async function seedHealthyOrder(
  shopId: number,
  opts: { quantity: number; variantId?: string; productId?: string }
): Promise<{ orderId: string; variantId: string; productId: string; quantity: number }> {
  const lasyncroOrderId = crypto.randomUUID();
  const now = new Date();

  let { variantId, productId } = opts;
  if (!variantId || !productId) {
    const v = await withTenant(shopId, (trx) =>
      trx('variants').where({ shop_id: shopId }).orderBy('sku', 'asc')
        .first('lasyncro_variant_id', 'lasyncro_product_id')
    );
    variantId = v.lasyncro_variant_id;
    productId = v.lasyncro_product_id;
  }

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
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
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Release Regression Fixture Line',
      quantity: opts.quantity,
      unit_price: '10.00',
      line_total: (10 * opts.quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });
    // order_fulfillment_status is projection-single-writer guarded (migration
    // 0076). Transaction-local guard, same pattern release-readiness.test.ts
    // uses to seed this table for an authorised fixture.
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return { orderId: lasyncroOrderId, variantId: variantId!, productId: productId!, quantity: opts.quantity };
}


async function fixture() {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const f = await provisionFt2Shop(crypto.randomUUID());
  const variants = await withTenant(f.shopId, trx => trx('variants').where({ shop_id: f.shopId })
    .orderBy('sku').limit(3).select('lasyncro_variant_id', 'lasyncro_product_id'));
  expect(variants).toHaveLength(3);
  const o = await seedHealthyOrder(f.shopId, { quantity: 2, variantId: variants[0].lasyncro_variant_id, productId: variants[0].lasyncro_product_id });
  await withTenant(f.shopId, async trx => {
    for (const [i, quantity] of [[1, 5], [2, 3]]) {
      await trx('order_line_items').insert({
        lasyncro_line_item_id: crypto.randomUUID(), lasyncro_order_id: o.orderId,
        lasyncro_product_id: variants[i].lasyncro_product_id, lasyncro_variant_id: variants[i].lasyncro_variant_id,
        title: 'GH1049 allocation', quantity, unit_price: '10.00', line_total: String(quantity * 10),
        created_at: new Date(), updated_at: new Date(),
      });
    }
  });
  const p = await seedHealthyOrder(f.shopId, { quantity: 1, variantId: variants[0].lasyncro_variant_id, productId: variants[0].lasyncro_product_id });
  const release = await postRelease(f.token, { priority_order_ids: [o.orderId, p.orderId], exclusive: true });
  expect({ status: release.status, body: release.body }).toMatchObject({ status: 201, body: { order_count: 2 } });
  const batchId = release.body.pick_batch_id;
  const claim = await request(app).post(`/api/v1/wms/batch/${batchId}/claim`).set('Authorization', `Bearer ${f.token}`).send({});
  expect({ status: claim.status, body: claim.body }).toMatchObject({ status: 200 });
  const allocations = await withTenant(f.shopId, trx => trx('pick_reservation_allocations as a')
    .join('order_line_items as l', 'l.lasyncro_line_item_id', 'a.lasyncro_line_item_id')
    .where({ 'a.shop_id': f.shopId, 'a.pick_batch_id': batchId }).select('a.*', 'l.lasyncro_order_id'));
  expect(allocations).toHaveLength(4);
  const owned = allocations.filter(a => a.lasyncro_order_id === o.orderId);
  const A = owned.find(a => Number(a.quantity) === 2)!;
  const B = owned.find(a => Number(a.quantity) === 5)!;
  const C = owned.find(a => Number(a.quantity) === 3)!;
  const P = allocations.find(a => a.lasyncro_order_id === p.orderId)!;
  expect([A, B, C, P].every(Boolean)).toBe(true);
  return { ...f, batchId, o, p, A, B, C, P };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function scan(f: Fixture, a: any) {
  return request(app).post('/api/v1/wms/pick/scan').set('Authorization', `Bearer ${f.token}`).send({
    pick_batch_id: f.batchId, lasyncro_line_item_id: a.lasyncro_line_item_id,
    lasyncro_variant_id: a.lasyncro_variant_id, reservation_allocation_id: a.allocation_id,
    location_code: a.location_code, quantity_confirmed: Number(a.quantity),
  });
}
function report(
  f: Fixture,
  a = f.B,
  type = 'item_missing',
  found = 0,
  deviceEventId = crypto.randomUUID()
) {
  return request(app)
    .post(`/api/v1/wms/batch/${f.batchId}/exception`)
    .set('Authorization', `Bearer ${f.token}`)
    .send({
      lasyncro_line_item_id: a.lasyncro_line_item_id,
      lasyncro_variant_id: a.lasyncro_variant_id,
      reservation_allocation_id: a.allocation_id,
      location_code: a.location_code,
      exception_type: type,
      stage: 'pick',
      quantity_required: Number(a.quantity),
      quantity_found: found,
      device_event_id: deviceEventId,
      notes: 'GH1049 observed stock at allocation location',
    });
}

async function snapshot(f: Fixture) {
  return withTenant(f.shopId, async trx => ({
    allocations: await trx('pick_reservation_allocations')
      .where({ shop_id: f.shopId })
      .orderBy('allocation_id'),

    scans: await trx('pick_scan_log')
      .where({ shop_id: f.shopId })
      .orderBy('scan_id'),

    exceptions: await trx('pick_exceptions')
      .where({ shop_id: f.shopId })
      .orderBy('pick_exception_id'),

    tasks: await trx('problem_center_tasks')
      .where({ shop_id: f.shopId })
      .orderBy('problem_task_id'),

    members: await trx('pick_batch_orders')
      .where({ shop_id: f.shopId })
      .orderBy('lasyncro_order_id'),

    ows: await trx('order_warehouse_status')
      .whereIn('lasyncro_order_id', [f.o.orderId, f.p.orderId])
      .orderBy('lasyncro_order_id'),

    olws: await trx('order_line_item_warehouse_status')
      .where({ shop_id: f.shopId })
      .orderBy('lasyncro_line_item_id'),

    movements: await trx('inventory_movements')
      .where({ shop_id: f.shopId })
      .orderBy('lasyncro_inventory_movement_id'),

    truth: await trx('inventory_truth')
      .where({ shop_id: f.shopId })
      .orderBy(['lasyncro_variant_id', 'location_code']),

    batch: await trx('pick_batches')
      .where({ shop_id: f.shopId, pick_batch_id: f.batchId })
      .first(),
  }));
}

function stock(s: any, a: any) {
  const row = s.truth.find(
    (t: any) =>
      t.lasyncro_variant_id === a.lasyncro_variant_id &&
      t.location_code === a.location_code
  );

  return {
    onHand: Number(row.on_hand_quantity),
    reserved: Number(row.reserved_quantity),
    available: Number(row.available_quantity),
  };
}

function newMovements(before: any, after: any) {
  const beforeIds = new Set(
    before.movements.map((m: any) => m.lasyncro_inventory_movement_id)
  );

  return after.movements.filter(
    (m: any) => !beforeIds.has(m.lasyncro_inventory_movement_id)
  );
}

function exceptionForAllocation(s: any, a: any) {
  return s.exceptions.filter(
    (e: any) =>
      e.reservation_allocation_id === a.allocation_id &&
      e.stage === 'pick'
  );
}

function tasksForException(s: any, exceptionId: string) {
  return s.tasks.filter(
    (t: any) =>
      t.source === 'pick' &&
      t.source_exception_id === exceptionId
  );
}

it('item-missing exception keeps the affected order in the batch and picker continues healthy work', async () => {
  const f = await fixture();

  expect((await scan(f, f.A)).status).toBe(201);

  const before = await snapshot(f);
  const reportResult = await report(
    f,
    f.B,
    'item_missing',
    0,
    crypto.randomUUID()
  );

  expect({
    status: reportResult.status,
    body: reportResult.body,
  }).toMatchObject({
    status: 201,
    body: {
      pick_exception_id: expect.any(String),
    },
  });

  const exceptionId = reportResult.body.pick_exception_id as string;
  const after = await snapshot(f);

  expect(exceptionForAllocation(after, f.B)).toEqual([
    expect.objectContaining({
      pick_exception_id: exceptionId,
      reservation_allocation_id: f.B.allocation_id,
      exception_type: 'item_missing',
      quantity_required: 5,
      quantity_found: 0,
      resolved: false,
    }),
  ]);

  expect(tasksForException(after, exceptionId)).toEqual([
    expect.objectContaining({
      source: 'pick',
      source_exception_id: exceptionId,
      lasyncro_variant_id: f.B.lasyncro_variant_id,
      quantity: 5,
    }),
  ]);

  // Reporting the exception accounts for Pick work but does not fabricate
  // a physical pick for a completely missing allocation.
  expect(after.scans).toEqual(before.scans);
  expect(after.movements).toEqual(before.movements);
  expect(stock(after, f.B)).toEqual(stock(before, f.B));

  // Allocation ownership and batch membership remain intact.
  expect(after.allocations).toEqual(before.allocations);
  expect(after.members).toEqual(before.members);

  // The picker is never interrupted by the affected order.
  expect((await scan(f, f.C)).status).toBe(201);
  expect((await scan(f, f.P)).status).toBe(201);

  const complete = await request(app)
    .post(`/api/v1/wms/batch/${f.batchId}/pick-complete`)
    .set('Authorization', `Bearer ${f.token}`)
    .send({});

  expect({
    status: complete.status,
    body: complete.body,
  }).toMatchObject({
    status: 200,
  });

  const completed = await snapshot(f);

  expect(completed.batch.status).toBe('pick_complete');

  expect(
    completed.members.map((m: any) => m.lasyncro_order_id).sort()
  ).toEqual(
    [f.o.orderId, f.p.orderId].sort()
  );
});

it('short-pick is one atomic composite outcome: physically found quantity plus missing exception quantity', async () => {
  const f = await fixture();
  const before = await snapshot(f);

  const result = await report(
    f,
    f.B,
    'short_pick',
    3,
    crypto.randomUUID()
  );

  expect({
    status: result.status,
    body: result.body,
  }).toMatchObject({
    status: 201,
    body: {
      pick_exception_id: expect.any(String),
    },
  });

  const exceptionId = result.body.pick_exception_id as string;
  const after = await snapshot(f);

  expect(exceptionForAllocation(after, f.B)).toEqual([
    expect.objectContaining({
      pick_exception_id: exceptionId,
      reservation_allocation_id: f.B.allocation_id,
      exception_type: 'short_pick',
      quantity_required: 5,
      quantity_found: 3,
    }),
  ]);

  expect(
    after.scans.filter(
      (s: any) =>
        s.reservation_allocation_id === f.B.allocation_id &&
        s.status === 'confirmed'
    )
  ).toEqual([
    expect.objectContaining({
      reservation_allocation_id: f.B.allocation_id,
      quantity_confirmed: 3,
    }),
  ]);

  // Problem work owns only the missing remainder.
  expect(tasksForException(after, exceptionId)).toEqual([
    expect.objectContaining({
      source_exception_id: exceptionId,
      lasyncro_variant_id: f.B.lasyncro_variant_id,
      quantity: 2,
    }),
  ]);

  const added = newMovements(before, after)
    .filter(
      (m: any) =>
        m.lasyncro_variant_id === f.B.lasyncro_variant_id
    );

  expect(
    added.filter((m: any) => m.movement_type === 'pick_removal')
  ).toEqual([
    expect.objectContaining({
      quantity_delta: -3,
      location_code: f.B.location_code,
    }),
  ]);

  expect(
    added.filter((m: any) => m.movement_type === 'reservation_release')
  ).toEqual([
    expect.objectContaining({
      quantity_delta: -3,
      location_code: f.B.location_code,
    }),
  ]);

  expect(stock(after, f.B)).toEqual({
    onHand: stock(before, f.B).onHand - 3,
    reserved: stock(before, f.B).reserved - 3,
    available: stock(before, f.B).available,
  });

  expect(Number(after.batch.units_picked)).toBe(
    Number(before.batch.units_picked) + 3
  );

  // Allocation identity remains immutable even for the composite outcome.
  expect(after.allocations).toEqual(before.allocations);

  // Remaining healthy work continues normally.
  expect((await scan(f, f.A)).status).toBe(201);
  expect((await scan(f, f.C)).status).toBe(201);
  expect((await scan(f, f.P)).status).toBe(201);

  const complete = await request(app)
    .post(`/api/v1/wms/batch/${f.batchId}/pick-complete`)
    .set('Authorization', `Bearer ${f.token}`)
    .send({});

  expect(complete.status).toBe(200);

  const completed = await snapshot(f);
  expect(completed.batch.status).toBe('pick_complete');
});

it('replaying the same exception device event returns the same canonical outcome without duplicates', async () => {
  const f = await fixture();
  const eventId = crypto.randomUUID();

  const first = await report(f, f.B, 'item_missing', 0, eventId);
  const second = await report(f, f.B, 'item_missing', 0, eventId);

  expect(first.status).toBe(201);
  expect(second.status).toBe(201);

  expect(second.body.pick_exception_id).toBe(
    first.body.pick_exception_id
  );

  const after = await snapshot(f);

  expect(exceptionForAllocation(after, f.B)).toHaveLength(1);

  expect(
    tasksForException(
      after,
      first.body.pick_exception_id as string
    )
  ).toHaveLength(1);
});

it('a different event cannot create a second exception for the same allocation', async () => {
  const f = await fixture();

  const first = await report(
    f,
    f.B,
    'item_missing',
    0,
    crypto.randomUUID()
  );

  expect(first.status).toBe(201);

  const beforeSecond = await snapshot(f);

  const second = await report(
    f,
    f.B,
    'item_missing',
    0,
    crypto.randomUUID()
  );

  expect(second.status).toBe(409);
  expect(await snapshot(f)).toEqual(beforeSecond);
});

it('full confirmed scan first rejects a later exception without any second outcome', async () => {
  const f = await fixture();

  expect((await scan(f, f.B)).status).toBe(201);

  const before = await snapshot(f);

  const result = await report(
    f,
    f.B,
    'item_missing',
    0,
    crypto.randomUUID()
  );

  expect(result.status).toBe(409);
  expect(result.body.error).not.toMatch(/temporarily blocked|NOT_READY/);
  expect(await snapshot(f)).toEqual(before);
});

it('item-missing exception first rejects a later normal scan without physical side effects', async () => {
  const f = await fixture();

  const result = await report(
    f,
    f.B,
    'item_missing',
    0,
    crypto.randomUUID()
  );

  expect(result.status).toBe(201);

  const before = await snapshot(f);

  const laterScan = await scan(f, f.B);

  expect(laterScan.status).toBe(409);
  expect(await snapshot(f)).toEqual(before);
});

it('concurrent replay of the same event produces one exception and one Problem task', async () => {
  const f = await fixture();
  const eventId = crypto.randomUUID();

  const [a, b] = await Promise.all([
    report(f, f.B, 'item_missing', 0, eventId),
    report(f, f.B, 'item_missing', 0, eventId),
  ]);

  expect([a.status, b.status].sort()).toEqual([201, 201]);

  expect(a.body.pick_exception_id).toBeTruthy();
  expect(b.body.pick_exception_id).toBe(a.body.pick_exception_id);

  const after = await snapshot(f);

  expect(exceptionForAllocation(after, f.B)).toHaveLength(1);
  expect(
    tasksForException(after, a.body.pick_exception_id as string)
  ).toHaveLength(1);
});

it('concurrent different events for the same allocation produce one winner and one deterministic conflict', async () => {
  const f = await fixture();

  const [a, b] = await Promise.all([
    report(f, f.B, 'item_missing', 0, crypto.randomUUID()),
    report(f, f.B, 'item_missing', 0, crypto.randomUUID()),
  ]);

  expect([a.status, b.status].sort()).toEqual([201, 409]);

  const winner = a.status === 201 ? a : b;
  const after = await snapshot(f);

  expect(exceptionForAllocation(after, f.B)).toHaveLength(1);
  expect(
    tasksForException(after, winner.body.pick_exception_id as string)
  ).toHaveLength(1);
});

/**
 * GH-1049 ATOMICITY CONTRACT — server-owned Problem-task creation must commit
 * or roll back together with the Pick exception.
 *
 * AUDIT (why this is not driven by a forced DB failure)
 * -----------------------------------------------------
 * There is no legitimate runtime-safe way to make the downstream Problem-task
 * write fail *after* exception creation today:
 *
 *  - The pick path never creates a Problem Center task at all. Allocation-backed
 *    reports are rejected up front with ALLOCATION_PICK_EXCEPTION_NOT_READY
 *    (apps/backend/src/api/wms/wms.controller.ts, httpReportPickException); the
 *    only writes that path performs are pick_exceptions + the supervisor alert.
 *  - problem_center_tasks (migration 0103) has no unique key, no CHECK, and no
 *    nullable-violating column a *valid* fixture could trip. Its only hard
 *    constraints (shop_id FK, lasyncro_variant_id FK RESTRICT) cannot be
 *    violated without destroying the allocation fixture itself, which would be
 *    fragile fixture corruption rather than a product failure.
 *  - Every existing writer inlines trx('problem_center_tasks').insert(...)
 *    (wms.controller.ts, stow.service.ts, inventoryRecount.service.ts,
 *    cancellationUnwind.service.ts, returnJobs.service.ts). There is no server
 *    helper module to fault-inject at yet.
 *
 * Forcing failure with CREATE FUNCTION / CREATE TRIGGER is not available: the
 * disposable-DB runtime role is deliberately unprivileged in schema public, and
 * weakening that is out of scope.
 *
 * So the contract is expressed against the seam the implementation must create:
 * a server-owned helper that writes the Problem task inside the *caller's*
 * transaction. Until that helper exists this test fails for exactly the same
 * reason as the other GH-1049 contracts — the behaviour is not implemented.
 * The moment task creation is extracted into PROBLEM_TASK_SEAM this narrow
 * fault injection activates and the test becomes the real rollback proof, with
 * no rewrite and no test-only production behaviour.
 *
 * Requirement the extraction must preserve for this seam to bite: the caller
 * must invoke the helper through its module binding (a normal named import
 * called at call time), not a destructured local copy captured at load time.
 */
const PROBLEM_TASK_SEAM = {
  module: 'api-src/services/wms/problemCenterTask.service',
  export: 'createProblemCenterTask',
};

it('exception and Problem-task creation are atomic when the downstream task write fails', async () => {
  const f = await fixture();
  const before = await snapshot(f);

  let seam: Record<string, unknown>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    seam = require(PROBLEM_TASK_SEAM.module);
  } catch (err) {
    throw new Error(
      'GH-1049 atomic rollback cannot be exercised yet: server-owned Problem ' +
      `Center task creation has not been extracted into ${PROBLEM_TASK_SEAM.module}. ` +
      'Extract it and this test activates unchanged. ' +
      `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  if (typeof seam[PROBLEM_TASK_SEAM.export] !== 'function') {
    throw new Error(
      `GH-1049 atomic rollback cannot be exercised yet: ${PROBLEM_TASK_SEAM.module} ` +
      `does not export a callable ${PROBLEM_TASK_SEAM.export}.`
    );
  }

  // Narrow fault at the real server helper boundary. No DDL, no privileged
  // role, no fixture corruption, no permission change — the disposable-DB and
  // RLS posture is identical to every other test in this file.
  const fault = jest
    .spyOn(seam as any, PROBLEM_TASK_SEAM.export)
    .mockImplementation(async () => {
      throw new Error('GH1049_FORCED_PROBLEM_TASK_FAILURE');
    });

  let response: Awaited<ReturnType<typeof report>> | undefined;

  try {
    response = await report(
      f,
      f.B,
      'item_missing',
      0,
      crypto.randomUUID()
    );

    /**
     * Asserted BEFORE the restore below. jest.spyOn(...).mockRestore() also
     * resets the mock's state, so it clears mock.calls — reading the call
     * count after restoring always reports 0 and proves nothing about whether
     * the seam was reached. The finally block still guarantees the spy is
     * removed even when this assertion fails.
     *
     * The exception path must actually route Problem-task creation through the
     * server helper — otherwise the rollback below would prove nothing.
     */
    expect(fault).toHaveBeenCalledTimes(1);
  } finally {
    fault.mockRestore();
  }

  expect(response?.status).toBe(500);

  // No half-written exception, physical movement, reservation release,
  // batch progress, or Problem task may survive the failed transaction.
  expect(await snapshot(f)).toEqual(before);
});
