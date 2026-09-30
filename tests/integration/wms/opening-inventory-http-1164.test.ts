// #1164 — opening inventory HTTP wiring.
//
// Service-level settlement semantics (physical truth establishment, empty-bin
// commit, committed-bin replay, unresolved-line rejection, review branches)
// are owned by tests/integration/inventory/opening-recount-bootstrap-progress
// .test.ts and are deliberately not repeated here. This file protects only the
// HTTP boundary:
//
// CONTRACT-1164-LINE-01: claimed owner adds a discovered line; the server
//   anchors it to the task's frozen scope_location_code with expected 0.
// CONTRACT-1164-LINE-02: retry returns the same canonical line, never a second.
// CONTRACT-1164-LINE-03: a different claimant is rejected with no line created.
// CONTRACT-1164-LINE-04: a non-opening recount task is rejected, no line.
// CONTRACT-1164-LINE-05: cross-tenant / unknown variant rejected, no line.
// CONTRACT-1164-LINE-06: the client cannot choose the persisted location.
// CONTRACT-1164-COMPLETE-01: claimant completes an empty opening bin.
// CONTRACT-1164-COMPLETE-02: an ordinary recount task cannot use opening-complete.
// CONTRACT-1164-COMPLETE-03: replay does not duplicate physical truth.
// CONTRACT-1164-DTO-01: operator task reads expose purpose + scope_location_code
//   without expected quantities.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';
import {
  claimRecountTask,
  startOpeningInventoryReconciliation,
} from 'api-src/services/wms/inventoryRecount.service';

jest.setTimeout(30000);

const app = createApp();

const OPENING_BIN = 'PICK-01';
const OTHER_BIN = 'PICK-02';

type Fixture = {
  shopId: number;
  warehouseId: string;
  variantId: string;
  ownerId: number;
  operatorAId: number;
  operatorBId: number;
  operatorAToken: string;
  operatorBToken: string;
  /** opening_inventory task frozen to OPENING_BIN, claimed by operator A. */
  openingTaskId: string;
};

type PreStartFixture = {
  shopId: number;
  warehouseId: string;
  ownerId: number;
  operatorAId: number;
  operatorBId: number;
  otherOwnerId: number;
  ownerToken: string;
};

async function createMember(
  shopId: number,
  unique: string,
  label: string,
  role: 'owner' | 'operator'
): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `opening-1164-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role,
      })
      .returning('id');
    const userId = row.id as number;

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: null,
    });

    return userId;
  });
}


async function createUserWithoutMembership(
  shopId: number,
  unique: string,
  label: string
): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `opening-1164-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role: 'operator',
      })
      .returning('id');

    return row.id as number;
  });
}

/**
 * Fresh opening-inventory shop whose initial cohort has NOT been created yet.
 * Used only by the /opening-inventory/start HTTP contracts below.
 */
async function createPreStartFixture(): Promise<PreStartFixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `opening-1164-start-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createMember(shopId, unique, 'start-owner', 'owner');
  const operatorAId = await createMember(shopId, unique, 'start-opA', 'operator');
  const operatorBId = await createMember(shopId, unique, 'start-opB', 'operator');
  const otherOwnerId = await createMember(shopId, unique, 'start-other-owner', 'owner');

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Opening 1164 start warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: OPENING_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: OTHER_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);
  });

  return {
    shopId,
    warehouseId,
    ownerId,
    operatorAId,
    operatorBId,
    otherOwnerId,
    ownerToken: issueTestToken({
      userId: ownerId,
      shopId,
      tier: 'core',
      roles: ['owner'],
    }),
  };
}

async function openingStartTasks(fixture: PreStartFixture) {
  return withTenant(fixture.shopId, (trx) =>
    trx('inventory_recount_tasks')
      .where({
        shop_id: fixture.shopId,
        purpose: 'opening_inventory',
      })
      .select(
        'recount_task_id',
        'scope_location_code',
        'status',
        'assigned_to',
        'claimed_by'
      )
      .orderBy('scope_location_code', 'asc')
  );
}

function postOpeningStart(
  fixture: PreStartFixture,
  body: Record<string, unknown>
) {
  return request(app)
    .post('/api/v1/wms/opening-inventory/start')
    .set('Authorization', `Bearer ${fixture.ownerToken}`)
    .send(body);
}


function getRecountAssignees(fixture: PreStartFixture) {
  return request(app)
    .get('/api/v1/operators/recount-assignees')
    .set('Authorization', `Bearer ${fixture.ownerToken}`);
}

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `opening-1164-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createMember(shopId, unique, 'owner', 'owner');
  const operatorAId = await createMember(shopId, unique, 'opA', 'operator');
  const operatorBId = await createMember(shopId, unique, 'opB', 'operator');

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Opening 1164 warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: OPENING_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: OTHER_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Opening 1164 product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OPEN-1164-${unique}`,
      title: 'Opening 1164 variant',
      unit_cost: '1.00',
      status: 'active',
    });
  });

  // Canonical opening bootstrap: one frozen task per active bin.
  const started = await withTenant(shopId, (trx) =>
    startOpeningInventoryReconciliation(trx, {
      shopId,
      warehouseId,
      createdBy: ownerId,
      assignedTo: operatorAId,
    })
  );

  const openingTask = started.bins.find((bin) => bin.location_code === OPENING_BIN);
  if (!openingTask) throw new Error(`${OPENING_BIN} opening inventory task missing`);

  await withTenant(shopId, (trx) =>
    claimRecountTask(trx, shopId, openingTask.recount_task_id, operatorAId)
  );

  return {
    shopId,
    warehouseId,
    variantId,
    ownerId,
    operatorAId,
    operatorBId,
    operatorAToken: issueTestToken({ userId: operatorAId, shopId, tier: 'core', roles: ['operator'] }),
    operatorBToken: issueTestToken({ userId: operatorBId, shopId, tier: 'core', roles: ['operator'] }),
    openingTaskId: openingTask.recount_task_id,
  };
}

/** Ordinary (cycle_count) recount task claimed by operator A. */
async function createCycleCountTask(fixture: Fixture): Promise<string> {
  return withTenant(fixture.shopId, async (trx) => {
    const [row] = await trx('inventory_recount_tasks')
      .insert({
        shop_id: fixture.shopId,
        warehouse_id: fixture.warehouseId,
        label: `CNT-1164-${crypto.randomBytes(4).toString('hex')}`,
        scope: 'location',
        purpose: 'cycle_count',
        status: 'claimed',
        blind: true,
        assigned_to: null,
        created_by: fixture.ownerId,
        claimed_by: fixture.operatorAId,
        claimed_at: new Date(),
        claim_generation: crypto.randomUUID(),
      })
      .returning(['recount_task_id']);
    return row.recount_task_id as string;
  });
}

async function taskLines(fixture: Fixture, taskId: string) {
  return withTenant(fixture.shopId, (trx) =>
    trx('inventory_recount_lines')
      .where({ shop_id: fixture.shopId, recount_task_id: taskId })
      .select('recount_line_id', 'lasyncro_variant_id', 'location_code', 'expected_quantity')
  );
}

async function taskStatus(fixture: Fixture, taskId: string): Promise<string> {
  const row = await withTenant(fixture.shopId, (trx) =>
    trx('inventory_recount_tasks')
      .where({ shop_id: fixture.shopId, recount_task_id: taskId })
      .first('status')
  );
  return String(row.status);
}

function postOpeningLine(taskId: string, token: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/wms/recount-tasks/${taskId}/opening-lines`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function postOpeningComplete(taskId: string, token: string) {
  return request(app)
    .post(`/api/v1/wms/recount-tasks/${taskId}/opening-complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}


describe('#1164 GET /operators/recount-assignees assignment discovery', () => {
  it('CONTRACT-1164-ASSIGNEES-01: exposes dispatcher self plus eligible operators, never another owner', async () => {
    const fixture = await createPreStartFixture();

    const response = await getRecountAssignees(fixture);

    expect(response.status).toBe(200);

    const ids = response.body.operators.map(
      (operator: { user_id: number }) => operator.user_id
    );

    expect(ids).toContain(fixture.ownerId);
    expect(ids).toContain(fixture.operatorAId);
    expect(ids).toContain(fixture.operatorBId);
    expect(ids).not.toContain(fixture.otherOwnerId);
  });

  it('CONTRACT-1164-ASSIGNEES-02: excludes operator-role targets without effective recount-count permission', async () => {
    const fixture = await createPreStartFixture();

    await withTenant(fixture.shopId, (trx) =>
      trx('shop_role_permissions').insert({
        shop_id: fixture.shopId,
        action: 'wms:recount:count',
        role: 'operator',
        granted: false,
      })
    );

    const response = await getRecountAssignees(fixture);

    expect(response.status).toBe(200);

    const ids = response.body.operators.map(
      (operator: { user_id: number }) => operator.user_id
    );

    // Dispatcher remains available as "Me" when their own role can count.
    expect(ids).toContain(fixture.ownerId);

    // Both warehouse operators share the denied operator-role permission.
    expect(ids).not.toContain(fixture.operatorAId);
    expect(ids).not.toContain(fixture.operatorBId);

    // Another owner/admin is never a generic floor execution target.
    expect(ids).not.toContain(fixture.otherOwnerId);
  });
});

describe('#1164 POST /opening-inventory/start assignment contract', () => {
  it('CONTRACT-1164-START-01: explicit assigned_to is required', async () => {
    const fixture = await createPreStartFixture();

    const response = await postOpeningStart(fixture, {});

    expect(response.status).toBe(400);
    expect(response.body?.code).toBe('OPENING_START_INVALID_REQUEST');
    expect(await openingStartTasks(fixture)).toHaveLength(0);
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '1'],
  ])(
    'CONTRACT-1164-START-02: invalid assigned_to (%s) is rejected',
    async (_label, assignedTo) => {
      const fixture = await createPreStartFixture();

      const response = await postOpeningStart(fixture, {
        assigned_to: assignedTo,
      });

      expect(response.status).toBe(400);
      expect(response.body?.code).toBe('OPENING_START_INVALID_REQUEST');
      expect(await openingStartTasks(fixture)).toHaveLength(0);
    }
  );

  it('CONTRACT-1164-START-03: target without an active shop membership is rejected', async () => {
    const fixture = await createPreStartFixture();
    const unique = crypto.randomBytes(6).toString('hex');

    const nonMemberId = await createUserWithoutMembership(
      fixture.shopId,
      unique,
      'start-non-member'
    );

    const response = await postOpeningStart(fixture, {
      assigned_to: nonMemberId,
    });

    expect(response.status).toBe(400);
    expect(response.body?.code).toBe('OPENING_START_INVALID_ASSIGNEE');
    expect(await openingStartTasks(fixture)).toHaveLength(0);
  });

  it('CONTRACT-1164-START-04: active member without recount-count permission is rejected', async () => {
    const fixture = await createPreStartFixture();

    await withTenant(fixture.shopId, (trx) =>
      trx('shop_role_permissions').insert({
        shop_id: fixture.shopId,
        action: 'wms:recount:count',
        role: 'operator',
        granted: false,
      })
    );

    const response = await postOpeningStart(fixture, {
      assigned_to: fixture.operatorAId,
    });

    expect(response.status).toBe(400);
    expect(response.body?.code).toBe('OPENING_START_INVALID_ASSIGNEE');
    expect(await openingStartTasks(fixture)).toHaveLength(0);
  });

  it('CONTRACT-1164-START-05: valid assignee receives the frozen cohort dispatched and unclaimed', async () => {
    const fixture = await createPreStartFixture();

    const response = await postOpeningStart(fixture, {
      assigned_to: fixture.operatorAId,
    });

    expect(response.status).toBe(200);

    const tasks = await openingStartTasks(fixture);

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.scope_location_code)).toEqual([
      OPENING_BIN,
      OTHER_BIN,
    ]);

    for (const task of tasks) {
      expect(task.status).toBe('dispatched');
      expect(task.assigned_to).toBe(fixture.operatorAId);
      expect(task.claimed_by).toBeNull();
    }
  });

  it('CONTRACT-1164-START-06: replay preserves one cohort and its original assignment', async () => {
    const fixture = await createPreStartFixture();

    const first = await postOpeningStart(fixture, {
      assigned_to: fixture.operatorAId,
    });
    expect(first.status).toBe(200);

    const before = await openingStartTasks(fixture);
    expect(before).toHaveLength(2);

    const second = await postOpeningStart(fixture, {
      assigned_to: fixture.operatorAId,
    });
    expect(second.status).toBe(200);

    const after = await openingStartTasks(fixture);

    expect(after.map((task) => task.recount_task_id)).toEqual(
      before.map((task) => task.recount_task_id)
    );

    for (const task of after) {
      expect(task.status).toBe('dispatched');
      expect(task.assigned_to).toBe(fixture.operatorAId);
      expect(task.claimed_by).toBeNull();
    }
  });
});

describe('#1164 POST /recount-tasks/:taskId/opening-lines', () => {
  it('CONTRACT-1164-LINE-01: claimed owner adds a line anchored to the frozen bin with expected 0', async () => {
    const fixture = await createFixture();

    const response = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: fixture.variantId,
    });

    expect([200, 201]).toContain(response.status);
    expect(response.body?.line).toMatchObject({
      lasyncro_variant_id: fixture.variantId,
      location_code: OPENING_BIN,
      expected_quantity: 0,
    });

    const lines = await taskLines(fixture, fixture.openingTaskId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      recount_line_id: response.body.line.recount_line_id,
      lasyncro_variant_id: fixture.variantId,
      location_code: OPENING_BIN,
    });
    expect(Number(lines[0].expected_quantity)).toBe(0);
  });

  it('CONTRACT-1164-LINE-02: retrying the same task + variant returns the same canonical line', async () => {
    const fixture = await createFixture();
    const body = { lasyncro_variant_id: fixture.variantId };

    const first = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, body);
    const second = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, body);

    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    expect(second.body?.line?.recount_line_id).toBe(first.body?.line?.recount_line_id);

    const lines = await taskLines(fixture, fixture.openingTaskId);
    expect(
      lines.filter(
        (line) =>
          line.lasyncro_variant_id === fixture.variantId && line.location_code === OPENING_BIN
      )
    ).toHaveLength(1);
  });

  it('CONTRACT-1164-LINE-03: a different claimant is rejected and no line is created', async () => {
    const fixture = await createFixture();

    const response = await postOpeningLine(fixture.openingTaskId, fixture.operatorBToken, {
      lasyncro_variant_id: fixture.variantId,
    });

    expect(response.status).toBe(409);
    expect(await taskLines(fixture, fixture.openingTaskId)).toHaveLength(0);
  });

  it('CONTRACT-1164-LINE-04: a non-opening recount task is rejected and no line is created', async () => {
    const fixture = await createFixture();
    const cycleTaskId = await createCycleCountTask(fixture);

    const response = await postOpeningLine(cycleTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: fixture.variantId,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await taskLines(fixture, cycleTaskId)).toHaveLength(0);
  });

  it('CONTRACT-1164-LINE-05: cross-tenant and unknown variants are rejected and no line is created', async () => {
    const fixture = await createFixture();
    const otherShop = await createFixture();

    const crossTenant = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: otherShop.variantId,
    });
    const unknown = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: crypto.randomUUID(),
    });

    for (const response of [crossTenant, unknown]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(await taskLines(fixture, fixture.openingTaskId)).toHaveLength(0);
    expect(await taskLines(otherShop, otherShop.openingTaskId)).toHaveLength(0);
  });

  it('CONTRACT-1164-LINE-06: a client-supplied location_code cannot move the persisted location', async () => {
    const fixture = await createFixture();

    await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: fixture.variantId,
      location_code: OTHER_BIN,
    });

    // Whether the extra field is ignored or rejected, nothing may be
    // persisted anywhere but the task's frozen bin.
    const lines = await taskLines(fixture, fixture.openingTaskId);
    expect(lines.every((line) => line.location_code === OPENING_BIN)).toBe(true);
    expect(lines.some((line) => line.location_code === OTHER_BIN)).toBe(false);
  });
});

describe('#1164 POST /recount-tasks/:taskId/opening-complete', () => {
  it('CONTRACT-1164-COMPLETE-01: the claimant completes an empty opening bin', async () => {
    const fixture = await createFixture();

    const response = await postOpeningComplete(fixture.openingTaskId, fixture.operatorAToken);

    expect(response.status).toBe(200);
    expect(await taskStatus(fixture, fixture.openingTaskId)).toBe('committed');
    expect(await taskLines(fixture, fixture.openingTaskId)).toHaveLength(0);
  });

  it('CONTRACT-1164-COMPLETE-02: an ordinary recount task cannot use opening-complete', async () => {
    const fixture = await createFixture();
    const cycleTaskId = await createCycleCountTask(fixture);

    const response = await postOpeningComplete(cycleTaskId, fixture.operatorAToken);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await taskStatus(fixture, cycleTaskId)).toBe('claimed');
  });

  it('CONTRACT-1164-COMPLETE-03: replaying completion does not duplicate physical truth', async () => {
    const fixture = await createFixture();

    const added = await postOpeningLine(fixture.openingTaskId, fixture.operatorAToken, {
      lasyncro_variant_id: fixture.variantId,
    });
    expect([200, 201]).toContain(added.status);
    const lineId = String(added.body.line.recount_line_id);

    const counted = await request(app)
      .post(`/api/v1/wms/recount-tasks/${fixture.openingTaskId}/lines/${lineId}/count`)
      .set('Authorization', `Bearer ${fixture.operatorAToken}`)
      .send({ counted_quantity: 2, count_method: 'bin_quantity' });
    expect(counted.status).toBe(200);

    const physicalTruth = () =>
      withTenant(fixture.shopId, async (trx) => {
        const movements = await trx('inventory_movements')
          .where({
            shop_id: fixture.shopId,
            movement_type: 'opening_inventory_reconcile',
            reference_type: 'recount_line',
            reference_id: lineId,
          })
          .count<{ count: string }>('* as count')
          .first();
        const units = await trx('inventory_units')
          .where({ shop_id: fixture.shopId, recount_line_id: lineId })
          .count<{ count: string }>('* as count')
          .first();
        return { movements: Number(movements?.count ?? 0), units: Number(units?.count ?? 0) };
      });

    const first = await postOpeningComplete(fixture.openingTaskId, fixture.operatorAToken);
    expect(first.status).toBe(200);
    expect(await taskStatus(fixture, fixture.openingTaskId)).toBe('committed');
    const afterFirst = await physicalTruth();
    expect(afterFirst).toEqual({ movements: 1, units: 2 });

    const replay = await postOpeningComplete(fixture.openingTaskId, fixture.operatorAToken);
    expect(replay.status).toBe(200);
    expect(await physicalTruth()).toEqual(afterFirst);
  });
});

describe('#1164 recount task DTO', () => {
  it('CONTRACT-1164-DTO-01: operator task reads expose purpose + scope_location_code without expected quantities', async () => {
    const fixture = await createFixture();

    const response = await request(app)
      .get('/api/v1/wms/recount-tasks')
      .set('Authorization', `Bearer ${fixture.operatorAToken}`);

    expect(response.status).toBe(200);
    const task = (response.body?.tasks ?? []).find(
      (entry: { recount_task_id: string }) => entry.recount_task_id === fixture.openingTaskId
    );
    expect(task).toMatchObject({
      purpose: 'opening_inventory',
      scope_location_code: OPENING_BIN,
    });
    expect(task).not.toHaveProperty('expected_quantity');
    expect(task).not.toHaveProperty('variance_count');
  });
});
