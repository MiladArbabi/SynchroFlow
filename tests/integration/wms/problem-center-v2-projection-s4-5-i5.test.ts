// S4-5 I5 — Problem Center V2 read-only projection (GET /wms/problem-center).
// Contract: the projection exposes the real variant, the Receive LSU, its held
// custody and the one recovery Stow, from persisted rows only, without changing
// role filtering, tenant isolation or the default open-only scope:
//
//   P1  held task: variant + LSU identity, unit held, custody verified, no Stow.
//   P2  after re_stow: the pending recovery Stow is projected; the task stays
//       open (approval is not completion) and inventory accounting is unchanged.
//   P2b after claim: the Stow reads in_progress; still open, still uncredited.
//   P3  after the exact-LSU confirmation: exactly one +1 receive_recovery credit
//       at the destination; the task leaves the default scope and is returned
//       only with include=recent_resolved — resolved re_stow, Stow completed at
//       the destination, unit stowed.
//   A1  the GET projection itself never changes inventory accounting.
//   T1  another shop never sees the task — open or resolved, with or without
//       include.
//   R1  operator scope unchanged: a task assigned to another user stays hidden
//       from the operator, visible to the owner; each task projects its own LSU.
//   J1  (M1-CORRECT-006) open Receive: custody verified but the originating job
//       is not closed — the projection reports the job status, the I2 service
//       refuses recovery (409 receive_not_closed) and nothing is written; after
//       the real close the same task reports 'closed'.
//   J2  Receive lineage: held LSUs of two jobs (one open, one closed) each
//       project their own job through the unit's Receive line; one row per task.
//
//   P4  (SAFETY-015) recovery_sync is projected per shop and per row:
//       eligible → available/shopify with variant_sync_mapped; flag OFF →
//       SYNC_DISABLED; a recovered unit reports its I4 sync row status
//       (pending until swept and pushed — never presented as done).
//
// SF-RECEIVE-PC-RELEASE-SAFETY-015: fixture shops are recovery-eligible
// (offline credential, mapped location, real empty converged cutover, flag ON).
//
// Reuses the I3 suite's real-route held-unit provisioning verbatim. Commits
// held units, custody, recovery Stows and credits: isolated held-unit step only.
const mockSyncStowedQuantityToShopify = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('api-src/services/wms/shopifyInventorySync.service', () => ({
  syncStowedQuantityToShopify: (...args: unknown[]) => mockSyncStowedQuantityToShopify(...args),
}));


import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { inspectReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { issueTestToken } from '../../unit/helpers/auth';
import { sweepRecoveryCredits } from 'api-src/services/wms/shopifyRecoveryInventorySync.service';
import { makeRecoverySyncEligible, provisionLinkedShopifyIntegration, RECOVERY_SYNC_FLAG, withRecoverySyncFlag } from './receive-recovery-sync-eligibility.fixture';

const app = createApp();
jest.setTimeout(300000);

const DELIVERY_DATE = '2026-10-30';
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── provisioning (I2 pattern) ──────────────────────────────────────────────

async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId)
      .orderBy('id', 'asc').select('id'));
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
      [`shopify-install+${shopDomain}@lasyncro.internal`]));
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

interface Shop { shopId: number; userId: number; token: string; problemBin: string; bin: (zone?: string | null, active?: boolean, type?: string) => Promise<string> }

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `pcv2i5-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  // SAFETY-015/C6: real zero-order Shopify link (no seed_fresh_install ROOT
  // stock); physical stock arrives only through real Receive flows.
  await provisionLinkedShopifyIntegration(shopId, shopDomain);
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const token = issueTestToken({ userId, shopId, tier: 'scale' });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);

  const bin = async (zone: string | null = 'storage', active = true, type = 'bin') => {
    const code = `PCI5-${(zone ?? 'none').toUpperCase()}-${shopId}-${crypto.randomBytes(3).toString('hex')}`;
    await withTenant(shopId, async (trx) => {
      const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
        .first('warehouse_id', 'root_location_code');
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code: code,
        parent_location_code: warehouse.root_location_code, active, type, zone_type: zone,
      });
    });
    return code;
  };
  const problemBin = await bin('problem');
  await makeRecoverySyncEligible(shopId, userId);
  return { shopId, userId, token, problemBin, bin };
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/PCI5${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/PCI5${nonce}`,
        title: `S4-5 I5 recovery fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-5-I5-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/PCI5${nonce}`, unitCost: { amount: '4.00' } },
        } }] },
      },
    }]));
  const mapping = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_variant_id: externalVariantId })
      .first('lasyncro_variant_id'));
  expect(mapping?.lasyncro_variant_id).toBeTruthy();
  return mapping!.lasyncro_variant_id as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function addOperator(shop: Shop): Promise<string> {
  const userId = await withTenant(shop.shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shop.shopId,
        email: `pc-i5-operator-${crypto.randomBytes(6).toString('hex')}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'operator',
        role: 'operator',
      })
      .returning('id');
    await trx('shop_memberships').insert({ shop_id: shop.shopId, user_id: row.id, role: 'operator', revoked_at: null });
    return row.id as number;
  });
  return issueTestToken({ userId, shopId: shop.shopId, tier: 'scale', roles: ['operator'] });
}

interface Job {
  shop: Shop; poId: string; supplierId: string; receiveJobId: string; lineId: string; variantId: string;
  acceptedIds: string[]; heldIds: string[]; taskIds: string[];
}

/** One accepted unit plus `held` recoverable (defect) units, labelled, placed and (by default) closed. */
async function heldJob(shop: Shop, held: number, { close = true }: { close?: boolean } = {}): Promise<Job> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const accepted = 1;
  const variantId = await seedMappedVariant(shop.shopId);
  const { poId, supplierId } = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-5 I5 supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-5 I5 held line', quantity_ordered: accepted + held, unit_cost_cents: 400,
    });
    return { poId: po.id as string, supplierId: String(supplier.id) };
  });
  const created = await request(app).post(`/api/v1/suppliers/purchase-orders/${poId}/receive-jobs`)
    .set(auth(shop.token)).send({ assigned_operator_id: shop.userId });
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  expect((await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  const line = await withTenant(shop.shopId, (trx) =>
    trx('receive_job_lines').where({ shop_id: shop.shopId, receive_job_id: receiveJobId }).first('receive_job_line_id'));
  const lineId = line.receive_job_line_id as string;
  expect((await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/lines/${lineId}/confirm-count`)
    .set(auth(shop.token)).send({ quantity_confirmed: accepted, device_event_id: crypto.randomUUID() })).status).toBe(200);

  await withTenant(shop.shopId, async (trx) => {
    await trx('receive_exceptions').insert({
      shop_id: shop.shopId, receive_job_id: receiveJobId, receive_job_line_id: lineId,
      lasyncro_variant_id: variantId, exception_type: 'defect', quantity_affected: held,
      accounting_role: null, counts_toward_shortfall: false, disposition: 'recoverable_held',
      notes: 'cracked casing', raised_by: shop.userId, raised_at: new Date(),
    });
    await inspectReceiveJobLine(trx, {
      shopId: shop.shopId, receiveJobId, lasyncroVariantId: variantId, receiveJobLineId: lineId,
      quantityAccepted: accepted, quantityRejected: 0, quantityMissing: 0, quantityDeferred: 0,
      quantityHeldRecoverable: held, deviceEventId: crypto.randomUUID(),
      requireExplicitDisposition: true, inspectedBy: shop.userId,
    });
  });
  const units = await withTenant(shop.shopId, (trx) =>
    trx('inventory_units').where({ shop_id: shop.shopId, receive_job_line_id: lineId })
      .orderBy('receive_sequence').select('lasyncro_unit_id', 'status'));
  const heldIds = units.filter((u: any) => u.status === 'held').map((u: any) => u.lasyncro_unit_id as string);
  const acceptedIds = units.filter((u: any) => u.status !== 'held').map((u: any) => u.lasyncro_unit_id as string);
  expect(heldIds).toHaveLength(held);

  expect((await request(app).post(`/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  for (const unitId of heldIds) {
    const placed = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/held-units/${unitId}/custody`)
      .set(auth(shop.token)).send({ location_code: shop.problemBin, device_event_id: crypto.randomUUID() });
    expect(placed.status).toBe(201);
  }
  if (close) expect((await closeJob(shop, receiveJobId)).status).toBe(200);

  const taskIds: string[] = [];
  for (const unitId of heldIds) {
    const t = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId, source: 'receive', lasyncro_unit_id: unitId })
        .first('problem_task_id'));
    taskIds.push(t.problem_task_id as string);
  }
  return { shop, poId, supplierId, receiveJobId, lineId, variantId, acceptedIds, heldIds, taskIds };
}

const closeJob = (shop: Shop, receiveJobId: string) =>
  request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/close`)
    .set(auth(shop.token)).send({ actual_delivery_date: DELIVERY_DATE });

// ── recovery Stow helpers ──────────────────────────────────────────────────

async function reStow(j: Job, i: number): Promise<string> {
  const res = await request(app).post(`/api/v1/wms/problem-center/${j.taskIds[i]}/resolve`)
    .set(auth(j.shop.token)).send({ resolution_action: 're_stow' });
  expect(res.status).toBe(200);
  return res.body.stow_task_id as string;
}
const setLocation = (token: string, stowId: string, location_code: string) =>
  request(app).patch(`/api/v1/wms/stow-tasks/${stowId}/location`).set(auth(token)).send({ location_code });
const claim = (token: string, stowId: string) =>
  request(app).post(`/api/v1/wms/stow-tasks/${stowId}/claim`).set(auth(token)).send({});
const confirm = (token: string, stowId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/wms/stow-tasks/${stowId}/confirm`).set(auth(token)).send(body);

let shopA: Shop;
let shopB: Shop;
const previousFlag = process.env[RECOVERY_SYNC_FLAG];

beforeAll(async () => {
  // SAFETY-015: approval guard only; this suite never starts the worker.
  process.env[RECOVERY_SYNC_FLAG] = 'true';
  shopA = await provisionFt2Shop('a');
  shopB = await provisionFt2Shop('b');
});

afterAll(async () => {
  if (previousFlag === undefined) delete process.env[RECOVERY_SYNC_FLAG];
  else process.env[RECOVERY_SYNC_FLAG] = previousFlag;
  await db.destroy();
});

const list = (token: string, include?: string) =>
  request(app).get('/api/v1/wms/problem-center').query(include ? { include } : {}).set(auth(token));
const rowOf = (res: request.Response, taskId: string) =>
  (res.body.problem_tasks as any[]).find((t) => t.problem_task_id === taskId);

/** Inventory accounting for the fixture variant: ledger movements and truth. */
const accounting = (shop: Shop, variantId: string) =>
  withTenant(shop.shopId, async (trx) => ({
    movements: await trx('inventory_movements').where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .orderBy('lasyncro_inventory_movement_id')
      .select('lasyncro_inventory_movement_id', 'movement_type', 'quantity_delta', 'location_code', 'triggered_by'),
    truth: await trx('inventory_truth').where({ shop_id: shop.shopId, lasyncro_variant_id: variantId })
      .orderBy('location_code').select('location_code', 'on_hand_quantity', 'available_quantity'),
  }));

/** A1: reading the projection (both scopes, owner and operator) writes nothing. */
async function expectReadOnly(shop: Shop, variantId: string, tokens: string[]) {
  const before = await accounting(shop, variantId);
  for (const token of tokens) {
    for (const include of [undefined, 'recent_resolved']) expect((await list(token, include)).status).toBe(200);
  }
  expect(await accounting(shop, variantId)).toEqual(before);
}

describe('S4-5 I5 — Problem Center V2 projection', () => {
  it('P1–P3 — held → approved (Awaiting Stow, uncredited) → recovered only after the confirmed Stow', async () => {
    const j = await heldJob(shopA, 1);
    const taskId = j.taskIds[0];
    const lsu = j.heldIds[0];

    // P1
    const atReceiveClose = await accounting(shopA, j.variantId);
    const held = await list(shopA.token);
    expect(held.status).toBe(200);
    expect(rowOf(held, taskId)).toEqual(expect.objectContaining({
      status: 'open', source: 'receive', lasyncro_variant_id: j.variantId, lasyncro_unit_id: lsu,
      unit_status: 'held', unit_location_code: shopA.problemBin, problem_bin_location: shopA.problemBin,
      receive_custody_verified: true, recovery_stow_task_id: null, recovery_stow_status: null,
      receive_job_id: j.receiveJobId, receive_job_status: 'closed',
    }));

    // P2
    const stowId = await reStow(j, 0);
    const approved = rowOf(await list(shopA.token), taskId);
    expect(approved).toEqual(expect.objectContaining({
      status: 'open', unit_status: 'held', recovery_stow_task_id: stowId, recovery_stow_status: 'pending',
      recovery_stow_location_code: null,
    }));
    // Approval writes no movement and no truth: accounting is exactly as Receive left it.
    expect(await accounting(shopA, j.variantId)).toEqual(atReceiveClose);
    await expectReadOnly(shopA, j.variantId, [shopA.token]);

    // P2b
    const destination = await shopA.bin('storage');
    expect((await setLocation(shopA.token, stowId, destination)).status).toBe(200);
    expect((await claim(shopA.token, stowId)).status).toBe(200);
    expect(rowOf(await list(shopA.token), taskId)).toEqual(expect.objectContaining({
      status: 'open', unit_status: 'held', recovery_stow_task_id: stowId, recovery_stow_status: 'in_progress',
      recovery_stow_location_code: destination,
    }));
    expect(await accounting(shopA, j.variantId)).toEqual(atReceiveClose);

    // P3
    expect((await confirm(shopA.token, stowId, { lasyncro_unit_id: lsu })).status).toBe(200);
    const recovered = await accounting(shopA, j.variantId);
    const credits = recovered.movements.filter((m: any) => m.triggered_by === 'receive_recovery');
    expect(credits).toEqual([expect.objectContaining({ quantity_delta: 1, location_code: destination })]);
    expect(recovered.movements).toHaveLength(atReceiveClose.movements.length + 1);
    await expectReadOnly(shopA, j.variantId, [shopA.token, shopB.token]);

    expect(rowOf(await list(shopA.token), taskId)).toBeUndefined();
    expect(rowOf(await list(shopA.token, 'recent_resolved'), taskId)).toEqual(expect.objectContaining({
      status: 'resolved', resolution_action: 're_stow', unit_status: 'stowed', unit_location_code: destination,
      recovery_stow_task_id: stowId, recovery_stow_status: 'completed', recovery_stow_location_code: destination,
    }));

    // T1 (resolved): the closed task never crosses tenants either.
    expect(rowOf(await list(shopB.token, 'recent_resolved'), taskId)).toBeUndefined();
  });

  it('T1 — another shop never sees the task', async () => {
    const j = await heldJob(shopA, 1);
    for (const include of [undefined, 'recent_resolved']) {
      const res = await list(shopB.token, include);
      expect(res.status).toBe(200);
      expect(rowOf(res, j.taskIds[0])).toBeUndefined();
    }
  });

  it('R1 — operator scope unchanged: tasks assigned to someone else stay hidden', async () => {
    const j = await heldJob(shopA, 2);
    const operatorToken = await addOperator(shopA);
    await withTenant(shopA.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shopA.shopId, problem_task_id: j.taskIds[1] })
        .update({ assigned_operator_id: shopA.userId }));

    const asOperator = await list(operatorToken, 'recent_resolved');
    expect(asOperator.status).toBe(200);
    expect(rowOf(asOperator, j.taskIds[0])).toEqual(expect.objectContaining({
      lasyncro_unit_id: j.heldIds[0], receive_job_id: j.receiveJobId, receive_job_status: 'closed',
    }));
    expect(rowOf(asOperator, j.taskIds[1])).toBeUndefined();

    // Exact LSU identity: each held unit's task projects that unit, and only it.
    const asOwner = await list(shopA.token);
    expect(rowOf(asOwner, j.taskIds[0])?.lasyncro_unit_id).toBe(j.heldIds[0]);
    expect(rowOf(asOwner, j.taskIds[1])?.lasyncro_unit_id).toBe(j.heldIds[1]);
    expect(j.heldIds[0]).not.toBe(j.heldIds[1]);
    await expectReadOnly(shopA, j.variantId, [shopA.token, operatorToken]);
  });
  it('J1 — open Receive: status projected, recovery refused and nothing written; closed after the real close', async () => {
    const j = await heldJob(shopA, 1, { close: false });
    const taskId = j.taskIds[0];

    const open = rowOf(await list(shopA.token), taskId);
    expect(open).toEqual(expect.objectContaining({
      status: 'open', unit_status: 'held', receive_custody_verified: true,
      receive_job_id: j.receiveJobId, recovery_stow_task_id: null,
    }));
    expect(typeof open.receive_job_status).toBe('string');
    expect(open.receive_job_status).not.toBe('closed');

    // The backend is the authority the UI now mirrors: no decision before close.
    const before = await accounting(shopA, j.variantId);
    for (const resolution_action of ['re_stow', 'discard', 'write_off']) {
      const res = await request(app).post(`/api/v1/wms/problem-center/${taskId}/resolve`)
        .set(auth(shopA.token)).send({ resolution_action });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('receive_not_closed');
    }
    const stows = await withTenant(shopA.shopId, (trx) =>
      trx('stow_tasks').where({ shop_id: shopA.shopId, trigger: 'receive_recovery', source_task_id: taskId }).select('stow_task_id'));
    expect(stows).toEqual([]);
    expect(await accounting(shopA, j.variantId)).toEqual(before);
    await expectReadOnly(shopA, j.variantId, [shopA.token]);

    expect((await closeJob(shopA, j.receiveJobId)).status).toBe(200);
    expect(rowOf(await list(shopA.token), taskId)).toEqual(expect.objectContaining({
      status: 'open', unit_status: 'held', receive_custody_verified: true,
      receive_job_id: j.receiveJobId, receive_job_status: 'closed', recovery_stow_task_id: null,
    }));
  });

  it('J2 — each held LSU projects its own Receive job; one row per task', async () => {
    const open = await heldJob(shopA, 2, { close: false });
    const closed = await heldJob(shopA, 1);
    const res = await list(shopA.token, 'recent_resolved');
    expect(res.status).toBe(200);

    const ids = (res.body.problem_tasks as any[]).map((t) => t.problem_task_id);
    expect(new Set(ids).size).toBe(ids.length);

    open.taskIds.forEach((taskId, i) => {
      expect(rowOf(res, taskId)).toEqual(expect.objectContaining({
        lasyncro_unit_id: open.heldIds[i], receive_job_id: open.receiveJobId,
      }));
      expect(rowOf(res, taskId).receive_job_status).not.toBe('closed');
    });
    expect(rowOf(res, closed.taskIds[0])).toEqual(expect.objectContaining({
      lasyncro_unit_id: closed.heldIds[0], receive_job_id: closed.receiveJobId, receive_job_status: 'closed',
    }));
    expect(open.receiveJobId).not.toBe(closed.receiveJobId);

    // Tenant boundary: the other shop sees neither job's tasks.
    const other = await list(shopB.token, 'recent_resolved');
    for (const taskId of [...open.taskIds, ...closed.taskIds]) expect(rowOf(other, taskId)).toBeUndefined();
  });
});

describe('SAFETY-015 — recovery availability projection', () => {
  it('P4 — recovery_sync per shop, variant_sync_mapped per row, recovered units report their I4 sync status', async () => {
    const j = await heldJob(shopA, 1);
    const taskId = j.taskIds[0];

    const eligible = await list(shopA.token);
    expect(eligible.body.recovery_sync).toEqual({ available: true, reason: null });
    expect(rowOf(eligible, taskId)).toEqual(expect.objectContaining({ variant_sync_mapped: true, recovery_sync_status: null }));

    const disabled = await withRecoverySyncFlag('false', () => list(shopA.token));
    expect(disabled.body.recovery_sync).toEqual({ available: false, reason: 'SYNC_DISABLED' });
    expect(rowOf(disabled, taskId)).toBeDefined();
    await expectReadOnly(shopA, j.variantId, [shopA.token]);

    const stowId = await reStow(j, 0);
    const destination = await shopA.bin('storage');
    expect((await setLocation(shopA.token, stowId, destination)).status).toBe(200);
    expect((await claim(shopA.token, stowId)).status).toBe(200);
    expect((await confirm(shopA.token, stowId, { lasyncro_unit_id: j.heldIds[0] })).status).toBe(200);
    // Credited in LaSyncro, not yet discovered by I4: no sync status to claim.
    expect(rowOf(await list(shopA.token, 'recent_resolved'), taskId)).toEqual(expect.objectContaining({
      status: 'resolved', recovery_stow_status: 'completed', recovery_sync_status: null,
    }));
    await sweepRecoveryCredits(shopA.shopId);
    expect(rowOf(await list(shopA.token, 'recent_resolved'), taskId)).toEqual(expect.objectContaining({
      recovery_sync_status: 'pending',
    }));
    // Shop B never sees shop A's sync state.
    expect(rowOf(await list(shopB.token, 'recent_resolved'), taskId)).toBeUndefined();
  });
});
