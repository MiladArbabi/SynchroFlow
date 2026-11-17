/** SF-PICK-ASSIGN-01 shared integration fixtures (real routes, disposable DB only). */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemQuery,
  systemTransaction,
  setTenantContext,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { issueTestToken } from '../../unit/helpers/auth';

export const app = createApp();

// ── provisioning (GH-1049 pattern) ────────────────────────────────────────────

export async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events').where({ shop_id: shopId }).andWhere('id', '>', afterId).orderBy('id', 'asc').select('id')
  );
  for (const row of rows) await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

export async function provisionFt2Shop(label: string) {
  const shopDomain = `spa-${label}-${Date.now()}.myshopify.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k as keyof typeof params]}`).join('&');
  const hmac = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET!).update(message).digest('hex');
  const install = await request(app).get('/api/v1/integrations/shopify/install').query({ ...params, hmac }).redirects(0);
  expect(install.status).toBe(302);
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [`shopify-install+${shopDomain}@lasyncro.internal`])
  );
  const ghost = lookup.rows?.[0]?.value;
  const shopId = ghost.shop_id as number;
  const ownerId = ghost.id as number;
  await seedFreshInstall(shopId);
  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId, platform: 'shopify', platform_shop_name: shopDomain,
      sync_status: 'COMPLETED', updated_at: new Date(),
    })
  );
  let c = 0;
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  c = await pumpEvents(shopId, c);
  const ownerToken = issueTestToken({ userId: ownerId, shopId });
  const confirm = await request(app).post('/api/v1/lifecycle/ft2/confirm').set('Authorization', `Bearer ${ownerToken}`).send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);
  return { shopId, ownerId, ownerToken };
}

export async function createMember(shopId: number, label: string, role: 'operator' | 'admin' | 'owner' = 'operator') {
  const unique = crypto.randomBytes(5).toString('hex');
  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({ shop_id: shopId, email: `spa-${label}-${unique}@test.example`, password_hash: 'x', first_name: label, role })
      .returning('id');
    return Number((row as any).id ?? row);
  });
  await withTenant(shopId, (trx) => trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role, revoked_at: null }));
  return { userId, token: issueTestToken({ userId, shopId, roles: [role] }) };
}

export async function seedOrder(shopId: number, variant: { lasyncro_variant_id: string; lasyncro_product_id: string }, quantity: number) {
  const orderId = crypto.randomUUID();
  const now = new Date();
  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId, shop_id: shopId, payment_state: 'paid', currency: 'USD',
      total_price: '100.00', subtotal_price: '100.00', total_tax: '0.00',
      order_created_at: now, order_updated_at: now, created_at: now, updated_at: now,
    });
    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId, shop_id: shopId, platform: 'shopify',
      external_order_id: String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(), lasyncro_order_id: orderId,
      lasyncro_product_id: variant.lasyncro_product_id, lasyncro_variant_id: variant.lasyncro_variant_id,
      sku: null, title: 'SF-PICK-ASSIGN-01 line', quantity, unit_price: '10.00',
      line_total: (10 * quantity).toFixed(2), created_at: now, updated_at: now,
    });
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: orderId, status: 'pending', status_updated_at: now,
    });
  });
  return orderId;
}

export type Shop = Awaited<ReturnType<typeof provisionFt2Shop>>;
export type Member = Awaited<ReturnType<typeof createMember>>;

export async function fixture() {
  expect(process.env.PGDATABASE).toMatch(/^synchroflow_test_[A-Za-z0-9_]+$/);
  const shop = await provisionFt2Shop(crypto.randomBytes(4).toString('hex'));
  const A = await createMember(shop.shopId, 'op-a');
  const B = await createMember(shop.shopId, 'op-b');
  const C = await createMember(shop.shopId, 'op-c');
  const variants = await withTenant(shop.shopId, (trx) =>
    trx('variants').where({ shop_id: shop.shopId }).orderBy('sku').limit(2).select('lasyncro_variant_id', 'lasyncro_product_id'));
  expect(variants).toHaveLength(2);
  return { shop, A, B, C, variants };
}
export type Fx = Awaited<ReturnType<typeof fixture>>;

export async function release(fx: Fx, assigned?: number | null) {
  const o1 = await seedOrder(fx.shop.shopId, fx.variants[0], 2);
  const o2 = await seedOrder(fx.shop.shopId, fx.variants[1], 1);
  const res = await request(app).post('/api/v1/wms/batch/release').set('Authorization', `Bearer ${fx.shop.ownerToken}`)
    .send({ priority_order_ids: [o1, o2], exclusive: true, ...(assigned !== undefined ? { assigned_operator_id: assigned } : {}) });
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
  const batchId = res.body.pick_batch_id as string;
  const allocations = await withTenant(fx.shop.shopId, (trx) =>
    trx('pick_reservation_allocations').where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).orderBy('allocation_id').select('*'));
  expect(allocations.length).toBeGreaterThanOrEqual(2);
  return { batchId, allocations };
}

export const claim = (token: string, batchId: string) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/claim`).set('Authorization', `Bearer ${token}`).send({});
export const assign = (token: string, batchId: string, assignee: number | null) =>
  request(app).patch(`/api/v1/wms/batch/${batchId}/assignment`).set('Authorization', `Bearer ${token}`).send({ assigned_operator_id: assignee });
export const scan = (token: string, batchId: string, a: any, generation?: string | null) =>
  request(app).post('/api/v1/wms/pick/scan').set('Authorization', `Bearer ${token}`).send({
    pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, quantity_confirmed: Number(a.quantity),
    ...(generation !== undefined ? { pick_claim_generation: generation } : {}),
  });
export const ack = (token: string, batchId: string, generation: string) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/custody-ack`).set('Authorization', `Bearer ${token}`).send({ pick_claim_generation: generation });
export const complete = (token: string, batchId: string, generation?: string) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/pick-complete`).set('Authorization', `Bearer ${token}`)
    .send(generation ? { pick_claim_generation: generation } : {});
export const shortPick = (token: string, batchId: string, a: any, generation?: string) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set('Authorization', `Bearer ${token}`).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, location_code: a.location_code, exception_type: 'short_pick',
    stage: 'pick', quantity_required: Number(a.quantity), quantity_found: 1, device_event_id: crypto.randomUUID(),
    ...(generation ? { pick_claim_generation: generation } : {}),
  });

export async function ageBatch(shopId: number, batchId: string, cols: { idleMinutes?: number; assignedMinutes?: number }) {
  await withTenant(shopId, async (trx) => {
    const patch: Record<string, unknown> = {};
    if (cols.idleMinutes !== undefined) {
      patch.pick_last_activity_at = trx.raw(`now() - (? * interval '1 minute')`, [cols.idleMinutes]);
      patch.pick_claimed_at = trx.raw(`now() - (? * interval '1 minute')`, [cols.idleMinutes]);
    }
    if (cols.assignedMinutes !== undefined) {
      patch.pick_assigned_at = trx.raw(`now() - (? * interval '1 minute')`, [cols.assignedMinutes]);
    }
    await trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).update(patch);
  });
}

export const batchRow = (shopId: number, batchId: string) =>
  withTenant(shopId, (trx) => trx('pick_batches').where({ shop_id: shopId, pick_batch_id: batchId }).first());

export const auditRows = (shopId: number, batchId: string, actionType: string) =>
  withTenant(shopId, (trx) =>
    trx('operator_audit_log').where({ shop_id: shopId, entity_id: batchId, action_type: actionType }).orderBy('occurred_at'));

/** Every inventory / progress / evidence row a takeover must never touch. */
export async function evidence(shopId: number, batchId: string) {
  return withTenant(shopId, async (trx) => ({
    movements: await trx('inventory_movements').where({ shop_id: shopId }).orderBy('lasyncro_inventory_movement_id').select('*'),
    truth: await trx('inventory_truth').where({ shop_id: shopId }).orderBy(['lasyncro_variant_id', 'location_code']).select('*'),
    units: await trx('inventory_units').where({ shop_id: shopId }).orderBy('id').select('*'),
    allocations: await trx('pick_reservation_allocations').where({ shop_id: shopId, pick_batch_id: batchId }).orderBy('allocation_id').select('*'),
    scans: await trx('pick_scan_log').where({ shop_id: shopId, pick_batch_id: batchId }).orderBy('scan_id').select('*'),
    exceptions: await trx('pick_exceptions').where({ shop_id: shopId, pick_batch_id: batchId }).orderBy('pick_exception_id').select('*'),
    unitsPicked: Number((await trx('pick_batches').where({ pick_batch_id: batchId }).first('units_picked')).units_picked),
  }));
}
