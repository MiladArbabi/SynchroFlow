// S4-5 I4 — discovery of REAL I3 recovery credits (receive flow → recovery
// Stow confirm) by the durable Shopify recovery sync, and the recovery credit
// under concurrent inventory projection rebuild (the recount truth writer).
//
//   DS1 one confirmed recovery → one sync row with I3's credit identity,
//       pending against the shop's converged baseline (SAFETY-015/C7: every
//       recovering shop now has one; held_no_baseline stays covered by the I4
//       cutover suite's classifier cases); no Shopify call; the tenant is
//       listed for work.
//   DS2 repeated and concurrent sweeps → still exactly one row per credit.
//   DS3 another shop's sweep sees and registers nothing of this shop.
//   RC1 recovery confirm vs rebuildInventoryProjectionForVariants (commitRecount's
//       truth writer), both forced orders: truth = ledger sum, one credit.
//
// Commits held units, custody, recovery Stows, outcome events and recovery
// credits: fixture pattern of receive-held-recovery-stow-s4-5-i3.test.ts.
const mockSyncStowedQuantityToShopify = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('api-src/services/wms/shopifyInventorySync.service', () => ({
  syncStowedQuantityToShopify: (...args: unknown[]) => mockSyncStowedQuantityToShopify(...args),
}));
const mockShopifyRequest = jest.fn(async (..._args: unknown[]) => {
  throw new Error('[S45_I4_TEST] default Shopify transport must not be reached');
});
jest.mock('api-src/services/shopify/shopifyClient.service', () => ({
  createShopifyGraphQLClient: () => ({ request: mockShopifyRequest }),
}));

import crypto from 'crypto';
import request from 'supertest';
import { knex as knexFactory, type Knex } from 'knex';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { inspectReceiveJobLine } from 'api-src/services/wms/receiveJob.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { recoveryCreditIdentity } from 'api-src/services/wms/receiveHeldRecoveryStow.service';
import {
  dispatchNextRecoveryCredit,
  recoverySyncIdentity,
  sweepRecoveryCredits,
} from 'api-src/services/wms/shopifyRecoveryInventorySync.service';
import { issueTestToken } from '../../unit/helpers/auth';
import { makeRecoverySyncEligible, provisionLinkedShopifyIntegration, RECOVERY_SYNC_FLAG } from './receive-recovery-sync-eligibility.fixture';

const app = createApp();
jest.setTimeout(300000);

const DELIVERY_DATE = '2026-10-30';
const EXTERNAL_BARCODE = '5012345678901';
const SYNCS = 'shopify_recovery_inventory_syncs';

let coord: Knex;
const previousFlag = process.env[RECOVERY_SYNC_FLAG];

beforeAll(async () => {
  // SAFETY-015: approval guard only; this suite never starts the worker.
  process.env[RECOVERY_SYNC_FLAG] = 'true';
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
  expect(String(process.env.PGDATABASE)).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  coord = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: String(process.env.PGPASSWORD || ''),
      database: String(process.env.PGDATABASE),
    },
    pool: { min: 1, max: 2 },
  });
});

afterAll(async () => {
  if (previousFlag === undefined) delete process.env[RECOVERY_SYNC_FLAG];
  else process.env[RECOVERY_SYNC_FLAG] = previousFlag;
  await coord?.destroy();
});

afterEach(() => {
  expect(mockShopifyRequest).not.toHaveBeenCalled();
});

// ── provisioning (I2 / I3 pattern) ─────────────────────────────────────────

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

interface Shop { shopId: number; userId: number; token: string; problemBin: string; storageBin: string }

/** SAFETY-015: every fixture shop is Shopify-linked and recovery-eligible. */
async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcvs45i4-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  // SAFETY-015/C6: real zero-order Shopify link (no seed_fresh_install ROOT
  // stock); physical stock arrives only through real Receive flows.
  await provisionLinkedShopifyIntegration(shopId, shopDomain);
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const token = issueTestToken({ userId, shopId, tier: 'scale' });
  const confirmFt2 = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirmFt2.status).toBe(200);
  await pumpEvents(shopId);

  const bin = async (zone: string) => {
    const code = `S45I4-${zone.toUpperCase()}-${shopId}-${crypto.randomBytes(3).toString('hex')}`;
    await withTenant(shopId, async (trx) => {
      const warehouse = await trx('warehouses').where({ shop_id: shopId, is_default: true })
        .first('warehouse_id', 'root_location_code');
      await trx('warehouse_locations').insert({
        shop_id: shopId, warehouse_id: warehouse.warehouse_id, location_code: code,
        parent_location_code: warehouse.root_location_code, active: true, type: 'bin', zone_type: zone,
      });
    });
    return code;
  };
  const problemBin = await bin('problem');
  const storageBin = await bin('storage');
  await makeRecoverySyncEligible(shopId, userId);
  return { shopId, userId, token, problemBin, storageBin };
}

/** The shop's one converged opening-cutover generation (its I4 baseline). */
async function convergedGenerationId(shopId: number): Promise<string> {
  const rows = await withTenant(shopId, (trx) =>
    trx('opening_inventory_cutover_executions').where({ shop_id: shopId, status: 'converged' }).pluck('generation_id'));
  expect(rows).toHaveLength(1);
  return String(rows[0]);
}

async function seedMappedVariant(shopId: number): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/S45I4${nonce}`;
  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [{
      node: {
        id: `gid://shopify/Product/S45I4${nonce}`,
        title: `S4-5 I4 recovery fixture ${nonce}`,
        status: 'ACTIVE',
        productType: 'Widgets',
        featuredImage: null,
        variants: { edges: [{ node: {
          id: externalVariantId,
          title: 'Default Title',
          sku: `S4-5-I4-${nonce}`,
          barcode: EXTERNAL_BARCODE,
          image: null,
          inventoryItem: { id: `gid://shopify/InventoryItem/S45I4${nonce}`, unitCost: { amount: '4.00' } },
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

interface Job { shop: Shop; lineId: string; variantId: string; heldIds: string[]; taskIds: string[] }

/** One accepted unit plus `held` recoverable units, labelled, placed and closed (I3 pattern). */
async function heldJob(shop: Shop, held: number): Promise<Job> {
  const accepted = 1;
  const variantId = await seedMappedVariant(shop.shopId);
  const poId = await withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `S4-5 I4 supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' }).returning('id');
    await trx('purchase_order_line_items').insert({
      po_id: po.id, shop_id: shop.shopId, lasyncro_variant_id: variantId,
      description: 'S4-5 I4 held line', quantity_ordered: accepted + held, unit_cost_cents: 400,
    });
    return po.id as string;
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
  expect(heldIds).toHaveLength(held);

  expect((await request(app).post(`/api/v1/wms/receive-job-lines/${lineId}/unit-labels/printed`)
    .set(auth(shop.token)).send({})).status).toBe(200);
  for (const unitId of heldIds) {
    const placed = await request(app)
      .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/held-units/${unitId}/custody`)
      .set(auth(shop.token)).send({ location_code: shop.problemBin, device_event_id: crypto.randomUUID() });
    expect(placed.status).toBe(201);
  }
  const closed = await request(app).post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/close`)
    .set(auth(shop.token)).send({ actual_delivery_date: DELIVERY_DATE });
  expect(closed.status).toBe(200);

  const taskIds: string[] = [];
  for (const unitId of heldIds) {
    const t = await withTenant(shop.shopId, (trx) =>
      trx('problem_center_tasks').where({ shop_id: shop.shopId, source: 'receive', lasyncro_unit_id: unitId })
        .first('problem_task_id'));
    taskIds.push(t.problem_task_id as string);
  }
  return { shop, lineId, variantId, heldIds, taskIds };
}

/** re_stow → destination → claim: ready to confirm. */
async function claimedRecovery(j: Job, i: number, destination: string): Promise<string> {
  const res = await request(app).post(`/api/v1/wms/problem-center/${j.taskIds[i]}/resolve`)
    .set(auth(j.shop.token)).send({ resolution_action: 're_stow' });
  expect(res.status).toBe(200);
  const stowId = res.body.stow_task_id as string;
  expect((await request(app).patch(`/api/v1/wms/stow-tasks/${stowId}/location`)
    .set(auth(j.shop.token)).send({ location_code: destination })).status).toBe(200);
  expect((await request(app).post(`/api/v1/wms/stow-tasks/${stowId}/claim`)
    .set(auth(j.shop.token)).send({})).status).toBe(200);
  return stowId;
}

const confirmRecovery = (j: Job, stowId: string, i: number) =>
  request(app).post(`/api/v1/wms/stow-tasks/${stowId}/confirm`)
    .set(auth(j.shop.token)).send({ lasyncro_unit_id: j.heldIds[i] });

async function syncRows(shopId: number) {
  return withTenant(shopId, (trx) => trx(SYNCS).where({ shop_id: shopId }).orderBy('credit_movement_id'));
}

async function ledgerAndTruth(j: Job, location: string) {
  return withTenant(j.shop.shopId, async (trx) => {
    const ledger = await trx('inventory_movements')
      .where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId, location_code: location })
      .sum({ total: 'quantity_delta' }).first();
    const truth = await trx('inventory_truth')
      .where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId, location_code: location })
      .first('on_hand_quantity');
    const credits = await trx('inventory_movements')
      .where({ shop_id: j.shop.shopId, lasyncro_variant_id: j.variantId, triggered_by: 'receive_recovery' })
      .count({ n: '*' }).first();
    return { ledger: Number(ledger?.total ?? 0), truth: Number(truth?.on_hand_quantity ?? 0), credits: Number(credits?.n ?? 0) };
  });
}

// ── DS ─────────────────────────────────────────────────────────────────────

describe('discovery of real I3 recovery credits', () => {
  it('DS1 registers the I3 credit once, pending against the converged baseline', async () => {
    const shop = await provisionFt2Shop('ds1');
    const j = await heldJob(shop, 1);
    const stowId = await claimedRecovery(j, 0, shop.storageBin);
    expect((await confirmRecovery(j, stowId, 0)).status).toBe(200);

    const tenants = await systemQuery(db.raw('SELECT shop_id FROM public.list_shopify_recovery_inventory_sync_tenants()'));
    expect(tenants.rows.map((r: any) => Number(r.shop_id))).toContain(shop.shopId);

    expect(await sweepRecoveryCredits(shop.shopId)).toEqual({ registered: 1, reclassified: 0 });
    const identity = recoveryCreditIdentity(stowId, j.heldIds[0]);
    const sync = recoverySyncIdentity(shop.shopId, identity.movementId);
    const rows = await syncRows(shop.shopId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      credit_movement_id: identity.movementId,
      device_event_id: identity.deviceEventId,
      lasyncro_unit_id: j.heldIds[0],
      lasyncro_variant_id: j.variantId,
      location_code: shop.storageBin,
      idempotency_key: sync.idempotencyKey,
      reference_document_uri: sync.referenceDocumentUri,
      status: 'pending',
      hold_reason: null,
      baseline_generation_id: await convergedGenerationId(shop.shopId),
      first_dispatched_at: null,
    }));

    // SAFETY-015/C7: no dispatch here — a pending credit would be pushed.
    expect(mockSyncStowedQuantityToShopify).not.toHaveBeenCalled();
  });

  it('DS2 repeated and concurrent sweeps keep exactly one row per credit', async () => {
    const shop = await provisionFt2Shop('ds2');
    const j = await heldJob(shop, 2);
    const first = await claimedRecovery(j, 0, shop.storageBin);
    expect((await confirmRecovery(j, first, 0)).status).toBe(200);
    await sweepRecoveryCredits(shop.shopId);
    expect(await sweepRecoveryCredits(shop.shopId)).toEqual({ registered: 0, reclassified: 0 });

    const second = await claimedRecovery(j, 1, shop.storageBin);
    expect((await confirmRecovery(j, second, 1)).status).toBe(200);
    const results = await Promise.all([sweepRecoveryCredits(shop.shopId), sweepRecoveryCredits(shop.shopId)]);
    expect(results.map((r) => r.registered).sort()).toEqual([0, 1]);

    const rows = await syncRows(shop.shopId);
    expect(rows.map((r: any) => r.lasyncro_unit_id).sort()).toEqual([...j.heldIds].sort());
  });

  it('DS3 another shop sees and registers nothing of this shop', async () => {
    const shop = await provisionFt2Shop('ds3a');
    const other = await provisionFt2Shop('ds3b');
    const j = await heldJob(shop, 1);
    const stowId = await claimedRecovery(j, 0, shop.storageBin);
    expect((await confirmRecovery(j, stowId, 0)).status).toBe(200);
    await sweepRecoveryCredits(shop.shopId);

    expect(await sweepRecoveryCredits(other.shopId)).toEqual({ registered: 0, reclassified: 0 });
    const leaked = await withTenant(other.shopId, (trx) => trx(SYNCS).where({ shop_id: shop.shopId }));
    expect(leaked).toEqual([]);
    expect(await dispatchNextRecoveryCredit(other.shopId)).toEqual({ kind: 'IDLE' });
  });
});

// ── RC ─────────────────────────────────────────────────────────────────────

describe('recovery credit vs projection rebuild (commitRecount truth writer)', () => {
  async function rebuild(j: Job) {
    await withTenant(j.shop.shopId, (trx) =>
      rebuildInventoryProjectionForVariants(j.shop.shopId, [j.variantId], trx, new Date()));
  }

  it('RC1a rebuild waiting on its shop lock while recovery commits → no lost credit', async () => {
    const shop = await provisionFt2Shop('rc1a');
    const j = await heldJob(shop, 1);
    const stowId = await claimedRecovery(j, 0, shop.storageBin);

    const release: { resolve?: () => void } = {};
    const held = coord.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [String(shop.shopId)]);
      await new Promise<void>((resolve) => { release.resolve = resolve; });
    });
    const rebuilding = rebuild(j);
    for (let i = 0; i < 400; i += 1) {
      const waiting = await coord.raw(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`);
      if (waiting.rows[0].n >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await confirmRecovery(j, stowId, 0)).status).toBe(200);
    release.resolve!();
    await held;
    await rebuilding;

    const state = await ledgerAndTruth(j, shop.storageBin);
    expect(state).toEqual({ ledger: 1, truth: 1, credits: 1 });
  });

  it('RC1b recovery waiting on its Stow lock while rebuild commits → no lost credit', async () => {
    const shop = await provisionFt2Shop('rc1b');
    const j = await heldJob(shop, 1);
    const stowId = await claimedRecovery(j, 0, shop.storageBin);

    const release: { resolve?: () => void } = {};
    const held = coord.transaction(async (trx) => {
      await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [String(shop.shopId)]);
      await trx('stow_tasks').where({ shop_id: shop.shopId, stow_task_id: stowId }).forUpdate().first('stow_task_id');
      await new Promise<void>((resolve) => { release.resolve = resolve; });
    });
    const confirming = confirmRecovery(j, stowId, 0);
    for (let i = 0; i < 400; i += 1) {
      const waiting = await coord.raw(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted`);
      if (waiting.rows[0].n >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await rebuild(j);
    release.resolve!();
    await held;
    expect((await confirming).status).toBe(200);

    const state = await ledgerAndTruth(j, shop.storageBin);
    expect(state).toEqual({ ledger: 1, truth: 1, credits: 1 });
  });
});
