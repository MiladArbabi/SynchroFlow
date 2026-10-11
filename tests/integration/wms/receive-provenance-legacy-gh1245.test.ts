/** GH-1245 B1: per-delivery GET dates and genuine pre-0208/v1 compatibility.
 * Existing createApp/supertest + disposable PostgreSQL fixture patterns.
 * Original GH-1245 RED suites remain untouched.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, { systemQuery, withTenant, runWithTenantContext } from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { getCommittedInboundQty } from 'api-src/services/purchasing/purchasingEvidence';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
jest.setTimeout(240000);

const DELIVERY_DATE = '2026-10-11';
/** A real GTIN makes accepted stock Stow-ready without LSU label acknowledgement (GH-1085 B6). */
const EXTERNAL_BARCODE = '5012345678900';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

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

interface Shop {
  shopId: number;
  userId: number;
  token: string;
  rootLocationCode: string;
}

async function provisionFt2Shop(label: string): Promise<Shop> {
  const shopDomain = `rcv1245-${label}-${crypto.randomBytes(3).toString('hex')}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      sync_status: 'COMPLETED', updated_at: new Date(),
    }));
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const atFt1 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first());
  expect(atFt1?.phase).toBe('FT1');
  const token = issueTestToken({ userId, shopId, tier: 'scale' });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  return { shopId, userId, token, rootLocationCode: `WH-${shopId}-ROOT` };
}

// ── fixtures ────────────────────────────────────────────────────────────────

async function seedMappedVariant(shopId: number, externalBarcode: string | null): Promise<string> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const externalVariantId = `gid://shopify/ProductVariant/1245R${nonce}`;

  await withTenant(shopId, (trx) =>
    syncProducts(trx, shopId, [
      {
        node: {
          id: `gid://shopify/Product/1245R${nonce}`,
          title: `GH1245 receive outstanding fixture ${nonce}`,
          status: 'ACTIVE',
          productType: 'Widgets',
          featuredImage: null,
          variants: {
            edges: [
              {
                node: {
                  id: externalVariantId,
                  title: 'Default Title',
                  sku: `GH1245-RCV-${nonce}`,
                  barcode: externalBarcode,
                  image: null,
                  inventoryItem: {
                    id: `gid://shopify/InventoryItem/1245R${nonce}`,
                    unitCost: { amount: '4.00' },
                  },
                },
              },
            ],
          },
        },
      },
    ]));

  const mapping = await withTenant(shopId, (trx) =>
    trx('external_product_identity_map')
      .where({ shop_id: shopId, platform: 'shopify', external_variant_id: externalVariantId })
      .first('lasyncro_variant_id'));
  expect(mapping?.lasyncro_variant_id).toBeTruthy();
  return mapping!.lasyncro_variant_id as string;
}

interface PoFixture {
  shop: Shop;
  lasyncroVariantId: string;
  supplierId: number;
  poId: string;
  poLineItemId: string;
  quantityOrdered: number;
}

/** supplier → single-line PO already marked arrived ('shipped'), as the merchant leaves it. */
async function shippedPo(
  shop: Shop,
  quantityOrdered: number,
  externalBarcode: string | null = EXTERNAL_BARCODE
): Promise<PoFixture> {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const lasyncroVariantId = await seedMappedVariant(shop.shopId, externalBarcode);

  return withTenant(shop.shopId, async (trx) => {
    const [supplier] = await trx('suppliers')
      .insert({ shop_id: shop.shopId, name: `GH1245 supplier ${crypto.randomUUID()}` })
      .returning('id');
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shop.shopId, supplier_id: supplier.id, status: 'shipped' })
      .returning('id');
    const [poLine] = await trx('purchase_order_line_items')
      .insert({
        po_id: po.id,
        shop_id: shop.shopId,
        lasyncro_variant_id: lasyncroVariantId,
        description: 'GH1245 receive outstanding line',
        quantity_ordered: quantityOrdered,
        unit_cost_cents: 400,
      })
      .returning('id');
    return {
      shop,
      lasyncroVariantId,
      supplierId: Number(supplier.id),
      poId: po.id as string,
      poLineItemId: poLine.id as string,
      quantityOrdered,
    };
  });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Real dispatcher create route; the shop owner self-assigns (GH-1109). */
function httpCreateJob(po: PoFixture, token: string = po.shop.token) {
  return request(app)
    .post(`/api/v1/suppliers/purchase-orders/${po.poId}/receive-jobs`)
    .set(auth(token))
    .send({ assigned_operator_id: po.shop.userId });
}

interface JobFixture {
  po: PoFixture;
  receiveJobId: string;
  receiveJobLineId: string;
}

async function lineIdFor(po: PoFixture, receiveJobId: string): Promise<string> {
  const line = await withTenant(po.shop.shopId, (trx) =>
    trx('receive_job_lines')
      .where({ shop_id: po.shop.shopId, receive_job_id: receiveJobId })
      .first('receive_job_line_id'));
  expect(line?.receive_job_line_id).toBeTruthy();
  return line!.receive_job_line_id as string;
}

async function claim(po: PoFixture, receiveJobId: string) {
  return request(app)
    .post(`/api/v1/suppliers/receive-jobs/${receiveJobId}/claim`)
    .set(auth(po.shop.token))
    .send({});
}

/** Created through the real route and claimed (GH-1111) — ready for execution. */
async function openJob(po: PoFixture): Promise<JobFixture> {
  const created = await httpCreateJob(po);
  expect(created.status).toBe(201);
  const receiveJobId = created.body.receive_job_id as string;
  expect((await claim(po, receiveJobId)).status).toBe(200);
  return { po, receiveJobId, receiveJobLineId: await lineIdFor(po, receiveJobId) };
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** Every consequence these contracts assert on, scoped to one PO fixture. */
async function poState(po: PoFixture) {
  const { shopId } = po.shop;
  return withTenant(shopId, async (trx) => {
    const poLine = await trx('purchase_order_line_items')
      .where({ shop_id: shopId, id: po.poLineItemId })
      .first('*');
    const poRow = await trx('purchase_orders')
      .where({ shop_id: shopId, id: po.poId })
      .first('status');
    const supplier = await trx('suppliers')
      .where({ shop_id: shopId, id: po.supplierId })
      .first('total_pos');
    const jobs = await trx('receive_jobs')
      .where({ shop_id: shopId, po_id: po.poId })
      .orderBy('created_at', 'asc')
      .select('*');
    const jobIds = jobs.map((job: any) => job.receive_job_id as string);
    const lines = jobIds.length === 0 ? [] : await trx('receive_job_lines')
      .where({ shop_id: shopId })
      .whereIn('receive_job_id', jobIds)
      .select('*');
    const lineIds = lines.map((line: any) => line.receive_job_line_id as string);
    const exceptions = jobIds.length === 0 ? [] : await trx('receive_exceptions')
      .where({ shop_id: shopId })
      .whereIn('receive_job_id', jobIds)
      .orderBy('raised_at', 'asc')
      .select('receive_exception_id', 'receive_job_id', 'exception_type', 'quantity_affected');
    const inboundMovements = await trx('inventory_movements')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: po.lasyncroVariantId,
        reference_type: 'receive_job',
        movement_type: 'inbound_purchase',
      })
      .select('reference_id', 'quantity_delta');
    const rootLedger = await trx('inventory_movements')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, location_code: po.shop.rootLocationCode })
      .sum<{ sum: string | null }>('quantity_delta as sum')
      .first();
    const rootTruth = await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, location_code: po.shop.rootLocationCode })
      .first('on_hand_quantity');
    const stowTasks = await trx('stow_tasks')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId, trigger: 'inbound_stock' })
      .select('quantity', 'receive_job_line_id');
    const units = lineIds.length === 0 ? [] : await trx('inventory_units')
      .where({ shop_id: shopId })
      .whereIn('receive_job_line_id', lineIds)
      .select('receive_job_line_id', 'lasyncro_unit_id');
    const problemCenterTasks = await trx('problem_center_tasks')
      .where({ shop_id: shopId, lasyncro_variant_id: po.lasyncroVariantId })
      .count<{ count: string }>('* as count')
      .first();
    const inspectAudits = jobIds.length === 0 ? { count: '0' } : await trx('operator_audit_log')
      .where({ shop_id: shopId, action_type: 'receive_inspect' })
      .whereIn('entity_id', jobIds)
      .count<{ count: string }>('* as count')
      .first();
    const committedInbound = await getCommittedInboundQty(trx, shopId, po.lasyncroVariantId);

    const onHand = rootTruth ? Number(rootTruth.on_hand_quantity) : 0;
    return {
      poStatus: poRow?.status ?? null,
      quantityOrdered: numOrNull(poLine?.quantity_ordered),
      quantityReceived: numOrNull(poLine?.quantity_received),
      quantityPendingDelivery: numOrNull(poLine?.quantity_pending_delivery),
      committedInbound: Number(committedInbound),
      supplierTotalPos: Number(supplier?.total_pos ?? 0),
      jobs,
      lines,
      exceptions: exceptions.map((e: any) => ({
        receiveJobId: e.receive_job_id,
        type: e.exception_type,
        quantity: Number(e.quantity_affected),
        id: e.receive_exception_id,
      })),
      inboundMovements: inboundMovements.map((m: any) => ({ referenceId: m.reference_id, quantity: Number(m.quantity_delta) })),
      inboundQuantity: inboundMovements.reduce((s: number, m: any) => s + Number(m.quantity_delta), 0),
      rootOnHand: onHand,
      /** INV-LEDGER-BYPASS-16: truth must always be reproduced by the ledger. */
      truthMinusLedger: onHand - Number(rootLedger?.sum ?? 0),
      stowTaskCount: stowTasks.length,
      stowQuantity: stowTasks.reduce((s: number, t: any) => s + Number(t.quantity), 0),
      unitCount: units.length,
      problemCenterTaskCount: Number(problemCenterTasks?.count ?? 0),
      inspectAuditCount: Number((inspectAudits as any)?.count ?? 0),
    };
  });
}


const DATE_A = '2026-10-09';
const DATE_B = '2026-10-11';

function getJob(j: JobFixture) {
  return request(app).get(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}`)
    .set(auth(j.po.shop.token));
}

function inspect(j: JobFixture, accepted: number, rejected: number, deferred?: number) {
  return request(app).post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/inspect`)
    .set(auth(j.po.shop.token)).send({
      lasyncro_variant_id: j.po.lasyncroVariantId,
      receive_job_line_id: j.receiveJobLineId,
      quantity_accepted: accepted, quantity_rejected: rejected,
      ...(deferred === undefined ? {} : { quantity_missing: 0, quantity_deferred: deferred }),
    });
}

function close(j: JobFixture, date: string) {
  return request(app).post(`/api/v1/suppliers/receive-jobs/${j.receiveJobId}/close`)
    .set(auth(j.po.shop.token)).send({ actual_delivery_date: date });
}

/** Seed the historical shape directly, never create or relabel a v2 job. */
async function legacyJob(po: PoFixture): Promise<JobFixture> {
  const seeded = await withTenant(po.shop.shopId, async (trx) => {
    const [job] = await trx('receive_jobs').insert({
      shop_id: po.shop.shopId, po_id: po.poId, assigned_operator_id: po.shop.userId,
      status: 'pending', total_variants: 1, total_units: po.quantityOrdered,
      // Omit 0208 columns: the migrated historical default must remain v1.
    }).returning('receive_job_id');
    const [line] = await trx('receive_job_lines').insert({
      shop_id: po.shop.shopId, receive_job_id: job.receive_job_id,
      po_line_item_id: po.poLineItemId, lasyncro_variant_id: po.lasyncroVariantId,
      quantity_expected: po.quantityOrdered,
    }).returning('receive_job_line_id');
    return { po, receiveJobId: job.receive_job_id, receiveJobLineId: line.receive_job_line_id };
  });
  expect((await claim(po, seeded.receiveJobId)).status).toBe(200);
  const initial = await poState(po);
  expect(initial.jobs[0].delivery_accounting_version).toBe(1);
  expect(initial.quantityPendingDelivery).toBeNull();
  expect(initial.lines[0]).toEqual(expect.objectContaining({
    quantity_delivered: null, quantity_missing: null, quantity_deferred: null,
    quantity_held_recoverable: null, inspection_complete: false,
  }));
  return seeded;
}

/** Include receipt accounting, stock, work, audit and notification state. */
async function economicState(po: PoFixture) {
  const state = await poState(po);
  const extra = await withTenant(po.shop.shopId, async (trx) => ({
    po: await trx('purchase_orders').where({ shop_id: po.shop.shopId, id: po.poId }).first('*'),
    supplier: await trx('suppliers').where({ shop_id: po.shop.shopId, id: po.supplierId }).first('*'),
    truth: await trx('inventory_truth').where({ shop_id: po.shop.shopId, lasyncro_variant_id: po.lasyncroVariantId }).orderBy('location_code').select('*'),
    printJobs: await trx('barcode_print_jobs').where({ shop_id: po.shop.shopId }).orderBy('print_job_id').select('*'),
    alerts: await trx('alerts').where({ shop_id: po.shop.shopId }).orderBy('id').select('*'),
  }));
  return { ...state, ...extra };
}

describe('GH-1245 B1 delivery provenance and genuine legacy-v1 receipt', () => {
  it('D1 — GET preserves delivery A and B independently, and a pending delivery has no inherited date', async () => {
    const shop = await provisionFt2Shop('dates');
    const po = await shippedPo(shop, 10);
    const first = await openJob(po);
    expect((await inspect(first, 6, 0, 4)).status).toBe(200);
    expect((await close(first, DATE_A)).status).toBe(200);
    const firstAfterA = await getJob(first);

    const created = await httpCreateJob(po);
    expect(created.status).toBe(201);
    const second = { po, receiveJobId: created.body.receive_job_id,
      receiveJobLineId: await lineIdFor(po, created.body.receive_job_id) };
    const pending = await getJob(second);
    expect((await claim(po, second.receiveJobId)).status).toBe(200);
    expect((await inspect(second, 4, 0, 0)).status).toBe(200);
    expect((await close(second, DATE_B)).status).toBe(200);
    const firstAfterB = await getJob(first);
    const secondAfterB = await getJob(second);
    const stored = await poState(po);

    expect([firstAfterA.status, pending.status, firstAfterB.status, secondAfterB.status])
      .toEqual([200, 200, 200, 200]);
    expect(pending.body.job.status).toBe('pending');
    expect(stored.jobs.map((job: any) => dateOnly(job.actual_delivery_date))).toEqual([DATE_A, DATE_B]);
    expect([
      dateOnly(firstAfterA.body.job.actual_delivery_date),
      dateOnly(pending.body.job.actual_delivery_date),
      dateOnly(firstAfterB.body.job.actual_delivery_date),
      dateOnly(secondAfterB.body.job.actual_delivery_date),
    ]).toEqual([DATE_A, null, DATE_A, DATE_B]);
  });

  it('L1 — a genuine v1 full receipt succeeds once without inventing physical history', async () => {
    const shop = await provisionFt2Shop('v1-full');
    const po = await shippedPo(shop, 3);
    const job = await legacyJob(po);
    const before = await poState(po);
    expect((await inspect(job, 3, 0)).status).toBe(200);
    expect((await close(job, DATE_A)).status).toBe(200);
    const after = await poState(po);
    expect({
      version: after.jobs[0].delivery_accounting_version,
      jobStatus: after.jobs[0].status, poStatus: after.poStatus,
      received: after.quantityReceived, pending: after.quantityPendingDelivery,
      delivered: after.lines[0].quantity_delivered,
      missing: after.lines[0].quantity_missing, deferred: after.lines[0].quantity_deferred,
      held: after.lines[0].quantity_held_recoverable,
      lsuCount: after.unitCount, receipt: after.inboundQuantity, truth: after.rootOnHand,
      truthMinusLedger: after.truthMinusLedger, stow: after.stowQuantity,
      supplierDelta: after.supplierTotalPos - before.supplierTotalPos,
      problemTasks: after.problemCenterTaskCount,
    }).toEqual({
      version: 1, jobStatus: 'closed', poStatus: 'received', received: 3, pending: null,
      delivered: null, missing: null, deferred: null, held: null,
      lsuCount: 3, receipt: 3, truth: 3, truthMinusLedger: 0, stow: 3,
      supplierDelta: 1, problemTasks: 0,
    });
    const beforeReplay = await economicState(po);
    expect((await close(job, DATE_A)).status).toBe(409);
    expect(await economicState(po)).toEqual(beforeReplay);
  });

  it('L2 — ambiguous partial inspection of a genuine v1 job fails closed with zero economic effects', async () => {
    const shop = await provisionFt2Shop('v1-partial');
    const po = await shippedPo(shop, 3);
    const job = await legacyJob(po);
    const before = await economicState(po);
    const refused = await inspect(job, 2, 1);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('RECEIVE_CLIENT_UPGRADE_REQUIRED');
    expect(await economicState(po)).toEqual(before);
    expect((await close(job, DATE_A)).status).toBe(409);
    expect(await economicState(po)).toEqual(before);
  });
});
