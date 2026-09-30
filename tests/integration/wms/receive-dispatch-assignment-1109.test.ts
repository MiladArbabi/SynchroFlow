/**
 * GH-1109 — Receive dispatch assignment and operator work queue.
 *
 * These contracts pin the approved dispatch -> assignment -> claim model:
 * creating Receive work requires a dispatcher-selected assignee, pure operators
 * only see their own assigned work, and recovery reassignment is a dispatcher
 * authority limited to pending/unstarted jobs.
 */

import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { createReceiveJob } from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

jest.setTimeout(180000);

beforeAll(() => {
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test_jwt_secret';
});

type Fixture = {
  shopId: number;
  otherShopId: number;
  ownerId: number;
  otherOwnerId: number;
  adminId: number;
  operatorAId: number;
  operatorBId: number;
  revokedOperatorId: number;
  crossShopOperatorId: number;
  ownerToken: string;
  adminToken: string;
  operatorAToken: string;
};

async function createUser(
  shopId: number,
  unique: string,
  label: string,
  role: 'owner' | 'admin' | 'operator',
  revoked = false
): Promise<number> {
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `receive-1109-${label}-${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: label,
        role,
      })
      .returning('id');

    return row.id as number;
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role,
      revoked_at: revoked ? new Date() : null,
    });
  });

  return userId;
}

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `receive-dispatch-1109-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const otherShopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `receive-dispatch-1109-other-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const ownerId = await createUser(shopId, unique, 'owner', 'owner');
  const otherOwnerId = await createUser(
    shopId,
    unique,
    'other-owner',
    'owner'
  );
  const adminId = await createUser(shopId, unique, 'admin', 'admin');
  const operatorAId = await createUser(shopId, unique, 'operator-a', 'operator');
  const operatorBId = await createUser(shopId, unique, 'operator-b', 'operator');
  const revokedOperatorId = await createUser(shopId, unique, 'revoked', 'operator', true);
  const crossShopOperatorId = await createUser(otherShopId, unique, 'cross-shop', 'operator');

  await withTenant(shopId, async (trx) => {
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });

    await trx('shop_wms_settings').insert({ shop_id: shopId, bootstrap_model: 'legacy_opening_balance_v1' });

    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: ownerId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
  });

  return {
    shopId,
    otherShopId,
    ownerId,
    otherOwnerId,
    adminId,
    operatorAId,
    operatorBId,
    revokedOperatorId,
    crossShopOperatorId,
    ownerToken: issueTestToken({ userId: ownerId, shopId, tier: 'growth', roles: ['owner'] }),
    adminToken: issueTestToken({ userId: adminId, shopId, tier: 'growth', roles: ['admin'] }),
    operatorAToken: issueTestToken({ userId: operatorAId, shopId, tier: 'growth', roles: ['operator'] }),
  };
}

async function createPurchaseOrder(fixture: Fixture): Promise<string> {
  return withTenant(fixture.shopId, async (trx) => {
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      title: 'GH1109 Receive product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: fixture.shopId,
      sku: `GH1109-${crypto.randomBytes(4).toString('hex')}`,
      title: 'Default Title',
      barcode: null,
      unit_cost: '1.00',
      status: 'active',
    });

    const [supplier] = await trx('suppliers')
      .insert({
        shop_id: fixture.shopId,
        name: `GH1109 Supplier ${crypto.randomUUID()}`,
      })
      .returning('id');

    const [po] = await trx('purchase_orders')
      .insert({
        shop_id: fixture.shopId,
        supplier_id: supplier.id,
        status: 'shipped',
      })
      .returning('id');

    await trx('purchase_order_line_items').insert({
      po_id: po.id,
      shop_id: fixture.shopId,
      lasyncro_variant_id: variantId,
      description: 'GH1109 dispatch line',
      quantity_ordered: 3,
      quantity_received: 0,
      unit_cost_cents: 100,
    });

    return po.id as string;
  });
}

async function createJob(
  fixture: Fixture,
  options: {
    assignedOperatorId: number | null;
    status?: 'pending' | 'in_progress' | 'closed';
    startedAt?: Date | null;
    closedAt?: Date | null;
  }
): Promise<string> {
  const poId = await createPurchaseOrder(fixture);

  return withTenant(fixture.shopId, async (trx) => {
    const receiveJobId = await createReceiveJob(trx, {
      shopId: fixture.shopId,
      poId,
      operatorId: options.assignedOperatorId,
    });

    await trx('receive_jobs')
      .where({ shop_id: fixture.shopId, receive_job_id: receiveJobId })
      .update({
        status: options.status ?? 'pending',
        started_at: options.startedAt ?? null,
        closed_at: options.closedAt ?? null,
      });

    return receiveJobId;
  });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('GH-1109 — Receive dispatch assignment', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    expect(process.env.PGDATABASE).toMatch(
      /^synchroflow_test_[A-Za-z0-9_]+$/
    );

    fixture = await createFixture();
  });

  it('rejects Receive creation without an assigned operator and does not create a job row', async () => {
    const poId = await createPurchaseOrder(fixture);

    const before = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs').where({ shop_id: fixture.shopId, po_id: poId }).count<{ count: string }[]>('* as count')
    );

    const response = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({});

    expect(response.status).toBe(400);

    const after = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs').where({ shop_id: fixture.shopId, po_id: poId }).count<{ count: string }[]>('* as count')
    );

    expect(Number(before[0].count)).toBe(0);
    expect(Number(after[0].count)).toBe(0);
  });

  it('creates pending assigned Receive work for an active same-shop warehouse worker', async () => {
    const poId = await createPurchaseOrder(fixture);

    const response = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.operatorAId });

    expect(response.status).toBe(201);

    const job = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs')
        .where({ shop_id: fixture.shopId, receive_job_id: response.body.receive_job_id })
        .first('status', 'assigned_operator_id', 'started_at')
    );

    expect(job?.status).toBe('pending');
    expect(job?.assigned_operator_id).toBe(fixture.operatorAId);
    expect(job?.started_at).toBeNull();
  });

  it('projects active Receive assignment onto the purchase-order read model', async () => {
    const poId = await createPurchaseOrder(fixture);

    const createResponse = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.operatorAId });

    expect(createResponse.status).toBe(201);

    const response = await request(app)
      .get('/api/v1/suppliers/purchase-orders')
      .set(auth(fixture.ownerToken));

    expect(response.status).toBe(200);

    const po = response.body.purchase_orders.find(
      (row: { id: string }) => row.id === poId
    );

    expect(po).toBeDefined();
    expect(po.receive_job_id).toBe(createResponse.body.receive_job_id);
    expect(po.receive_status).toBe('pending');
    expect(po.receive_assigned_operator_id).toBe(fixture.operatorAId);
    expect(po.receive_assigned_operator_name).toContain('operator-a');
  });

  it('allows dispatcher self-assignment but rejects another owner as a Receive assignee', async () => {
    const selfPoId = await createPurchaseOrder(fixture);

    const selfResponse = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${selfPoId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.ownerId });

    expect(selfResponse.status).toBe(201);

    const otherOwnerPoId = await createPurchaseOrder(fixture);

    const otherOwnerResponse = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${otherOwnerPoId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.otherOwnerId });

    expect(otherOwnerResponse.status).toBe(400);
    expect(otherOwnerResponse.body.error).toBe(
      'INVALID_RECEIVE_ASSIGNEE'
    );

    const job = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs')
        .where({
          shop_id: fixture.shopId,
          po_id: otherOwnerPoId,
        })
        .first('receive_job_id')
    );

    expect(job).toBeUndefined();
  });

  it('Receive assignee discovery exposes dispatcher self plus eligible operators, never another owner', async () => {
    const response = await request(app)
      .get('/api/v1/operators/receive-assignees')
      .set(auth(fixture.ownerToken));

    expect(response.status).toBe(200);

    const ids = response.body.operators.map(
      (operator: { user_id: number }) => operator.user_id
    );

    expect(ids).toContain(fixture.ownerId);
    expect(ids).toContain(fixture.operatorAId);
    expect(ids).toContain(fixture.operatorBId);
    expect(ids).not.toContain(fixture.otherOwnerId);
  });

  it.each([
    ['cross-shop user', () => fixture.crossShopOperatorId],
    ['revoked membership', () => fixture.revokedOperatorId],
  ])('rejects invalid Receive assignee: %s', async (_label, targetId) => {
    const poId = await createPurchaseOrder(fixture);

    const response = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: targetId() });

    expect(response.status).toBe(400);

    const job = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs').where({ shop_id: fixture.shopId, po_id: poId }).first('receive_job_id')
    );
    expect(job).toBeUndefined();
  });

  it('excludes active warehouse operators from Receive assignment when their role lacks a required execution permission', async () => {
    // Isolated shop: deliberately alter the configurable permission matrix
    // without affecting the shared fixture used by the rest of GH-1109.
    const isolatedFixture = await createFixture();

    // Receive assignment eligibility requires the full execution contract.
    // Revoking just one consequential action must make operator-role members
    // unavailable as dispatch targets.
    await withTenant(isolatedFixture.shopId, (trx) =>
      trx('shop_role_permissions').insert({
        shop_id: isolatedFixture.shopId,
        action: 'receive-job:close',
        role: 'operator',
        granted: false,
      })
    );

    const response = await request(app)
      .get('/api/v1/operators/receive-assignees')
      .set(auth(isolatedFixture.ownerToken));

    expect(response.status).toBe(200);

    const ids = response.body.operators.map(
      (operator: { user_id: number }) => operator.user_id
    );

    // Dispatcher remains available as "Me".
    expect(ids).toContain(isolatedFixture.ownerId);

    // Both active warehouse operators share the revoked operator-role
    // permission and therefore must not be offered for Receive dispatch.
    expect(ids).not.toContain(isolatedFixture.operatorAId);
    expect(ids).not.toContain(isolatedFixture.operatorBId);
  });

  it('rejects direct Receive assignment when the target role lacks a required execution permission', async () => {
    const isolatedFixture = await createFixture();

    // Deliberately make operator-role members unable to complete Receive.
    // The API boundary itself must enforce this; hiding them from the
    // dispatcher dropdown is not sufficient protection.
    await withTenant(isolatedFixture.shopId, (trx) =>
      trx('shop_role_permissions').insert({
        shop_id: isolatedFixture.shopId,
        action: 'receive-job:close',
        role: 'operator',
        granted: false,
      })
    );

    const poId = await createPurchaseOrder(isolatedFixture);

    const createResponse = await request(app)
      .post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
      .set(auth(isolatedFixture.ownerToken))
      .send({ assigned_operator_id: isolatedFixture.operatorAId });

    expect(createResponse.status).toBe(400);
    expect(createResponse.body.error).toBe('INVALID_RECEIVE_ASSIGNEE');

    const createdJob = await withTenant(isolatedFixture.shopId, (trx) =>
      trx('receive_jobs')
        .where({
          shop_id: isolatedFixture.shopId,
          po_id: poId,
        })
        .first('receive_job_id')
    );

    expect(createdJob).toBeUndefined();

    // Reassignment uses the same authoritative target validation. Seed the
    // legacy/pending job directly through the service so this assertion tests
    // PATCH /assignment rather than failing earlier during HTTP creation.
    const jobId = await createJob(isolatedFixture, {
      assignedOperatorId: isolatedFixture.operatorAId,
    });

    const reassignResponse = await request(app)
      .patch(`/api/v1/suppliers/receive-jobs/${jobId}/assignment`)
      .set(auth(isolatedFixture.ownerToken))
      .send({ assigned_operator_id: isolatedFixture.operatorBId });

    expect(reassignResponse.status).toBe(400);
    expect(reassignResponse.body.error).toBe('INVALID_RECEIVE_ASSIGNEE');

    const job = await withTenant(isolatedFixture.shopId, (trx) =>
      trx('receive_jobs')
        .where({
          shop_id: isolatedFixture.shopId,
          receive_job_id: jobId,
        })
        .first('assigned_operator_id')
    );

    expect(job?.assigned_operator_id).toBe(isolatedFixture.operatorAId);
  });

  it('pure operators see assigned self work, not unassigned pool or another operator work', async () => {
    const ownJobId = await createJob(fixture, { assignedOperatorId: fixture.operatorAId });
    const otherJobId = await createJob(fixture, { assignedOperatorId: fixture.operatorBId });
    const unassignedJobId = await createJob(fixture, { assignedOperatorId: null });

    const response = await request(app)
      .get('/api/v1/suppliers/receive-jobs?status=pending,in_progress')
      .set(auth(fixture.operatorAToken));

    expect(response.status).toBe(200);
    const ids = response.body.receive_jobs.map((job: any) => job.receive_job_id);

    expect(ids).toContain(ownJobId);
    expect(ids).not.toContain(otherJobId);
    expect(ids).not.toContain(unassignedJobId);
  });

  it('owner/admin broader Receive visibility remains intact', async () => {
    const ownJobId = await createJob(fixture, { assignedOperatorId: fixture.operatorAId });
    const otherJobId = await createJob(fixture, { assignedOperatorId: fixture.operatorBId });
    const unassignedJobId = await createJob(fixture, { assignedOperatorId: null });

    const response = await request(app)
      .get('/api/v1/suppliers/receive-jobs?status=pending,in_progress')
      .set(auth(fixture.ownerToken));

    expect(response.status).toBe(200);
    const ids = response.body.receive_jobs.map((job: any) => job.receive_job_id);

    expect(ids).toEqual(expect.arrayContaining([ownJobId, otherJobId, unassignedJobId]));
  });

  it('dispatcher can assign/reassign a pending unstarted Receive job to an eligible worker', async () => {
    const jobId = await createJob(fixture, { assignedOperatorId: fixture.operatorAId });

    const response = await request(app)
      .patch(`/api/v1/suppliers/receive-jobs/${jobId}/assignment`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.operatorBId });

    expect(response.status).toBe(200);

    const job = await withTenant(fixture.shopId, (trx) =>
      trx('receive_jobs')
        .where({ shop_id: fixture.shopId, receive_job_id: jobId })
        .first('assigned_operator_id', 'status', 'started_at')
    );

    expect(job?.assigned_operator_id).toBe(fixture.operatorBId);
    expect(job?.status).toBe('pending');
    expect(job?.started_at).toBeNull();
  });

  it.each([
    ['started/in-progress job', { status: 'in_progress' as const, startedAt: new Date(), closedAt: null }],
    ['closed job', { status: 'closed' as const, startedAt: new Date(), closedAt: new Date() }],
  ])('dispatcher cannot reassign %s', async (_label, state) => {
    const jobId = await createJob(fixture, {
      assignedOperatorId: fixture.operatorAId,
      ...state,
    });

    const response = await request(app)
      .patch(`/api/v1/suppliers/receive-jobs/${jobId}/assignment`)
      .set(auth(fixture.ownerToken))
      .send({ assigned_operator_id: fixture.operatorBId });

    expect(response.status).toBe(409);
  });

  it('pure operator cannot use dispatcher assignment authority', async () => {
    const jobId = await createJob(fixture, { assignedOperatorId: fixture.operatorAId });

    const response = await request(app)
      .patch(`/api/v1/suppliers/receive-jobs/${jobId}/assignment`)
      .set(auth(fixture.operatorAToken))
      .send({ assigned_operator_id: fixture.operatorBId });

    expect(response.status).toBe(403);
  });

  describe('GH-1109 residual — Receive onboarding spotlight persistence', () => {
    it.each([
      'receive_dispatch_assignment',
      'receive_assigned_work',
      'opening_inventory_count',
    ])('persists dismissal for %s', async (key) => {
      const dismissResponse = await request(app)
        .post(`/api/v1/user-state/spotlight/${key}/dismiss`)
        .set(auth(fixture.ownerToken));

      expect(dismissResponse.status).toBe(200);
      expect(dismissResponse.body).toEqual({
        dismissed: true,
        key,
      });

      const flagsResponse = await request(app)
        .get('/api/v1/user-state/onboarding-flags')
        .set(auth(fixture.ownerToken));

      expect(flagsResponse.status).toBe(200);
      expect(flagsResponse.body[`spotlight:dismissed:${key}`]).toBe(true);
    });

    it('continues to reject an unknown spotlight key', async () => {
      const response = await request(app)
        .post('/api/v1/user-state/spotlight/not_a_real_spotlight/dismiss')
        .set(auth(fixture.ownerToken));

      expect(response.status).toBe(400);
    });
  });

  describe('GH-1109 residual — GET /api/v1/operators/team authority', () => {
    it('owner can GET /api/v1/operators/team -> 200', async () => {
      const response = await request(app)
        .get('/api/v1/operators/team')
        .set(auth(fixture.ownerToken));

      expect(response.status).toBe(200);
    });

    it('admin can GET /api/v1/operators/team -> 200', async () => {
      const response = await request(app)
        .get('/api/v1/operators/team')
        .set(auth(fixture.adminToken));

      expect(response.status).toBe(200);
    });

    it('pure operator cannot GET /api/v1/operators/team -> 403 ACTION_FORBIDDEN', async () => {
      const response = await request(app)
        .get('/api/v1/operators/team')
        .set(auth(fixture.operatorAToken));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('ACTION_FORBIDDEN');
    });

    it('unauthenticated request remains 401', async () => {
      const response = await request(app).get('/api/v1/operators/team');

      expect(response.status).toBe(401);
    });

    it('returned rows remain tenant-scoped: no cross-shop member exposure', async () => {
      const response = await request(app)
        .get('/api/v1/operators/team')
        .set(auth(fixture.ownerToken));

      expect(response.status).toBe(200);

      const ids = response.body.operators.map(
        (operator: { user_id: number }) => operator.user_id
      );

      expect(ids).toContain(fixture.ownerId);
      expect(ids).toContain(fixture.adminId);
      expect(ids).toContain(fixture.operatorAId);
      expect(ids).not.toContain(fixture.crossShopOperatorId);
    });
  });
});
