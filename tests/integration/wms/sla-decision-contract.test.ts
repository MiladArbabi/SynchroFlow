/**
 * ORD-DECISION-01 / Slice 3A — FULFILMENT SLA BREACH IS URGENCY, NOT A BLOCKER.
 *
 * Permanent regression protection for the approved decision contract:
 *
 *   SLA-DEC-01  SLA breach never materialises an operational/sla_breach
 *               order_constraints row. The operational evaluator is inert
 *               (operationalConstraintEvaluator.ts, BL-01b) and the constraint
 *               projection persists evaluator output only — a breached order
 *               must stay constraint-free and therefore stay in the pool.
 *   SLA-DEC-02  Among otherwise equivalent releasable orders, an SLA-breached
 *               order sorts ahead of a non-breached one. Proven against an
 *               OLDER non-breached order so the breach key is shown to
 *               outrank the order_created_at ASC tiebreak, not merely agree
 *               with it.
 *   SLA-DEC-03  SLA breach alone has zero release side effects: no pick batch,
 *               no pick_batch_orders membership, no fulfilment-state
 *               advancement, no reservation hold. Release remains the explicit
 *               merchant POST /wms/batch/release action, which still works.
 *   SLA-DEC-04  A real evaluator-derived inventory blocker remains
 *               authoritative on an order that is simultaneously SLA-breached:
 *               it leaves the pool and is classified `blocked` on explicit
 *               release, mutating nothing.
 *   SLA-DEC-05  A fulfilled order is not actively Fulfillment-SLA breached —
 *               orderAgeProjection gates the breach on fulfilled_at IS NULL.
 *
 * These behaviours are already implemented; this file is added as permanent
 * regression coverage for existing verified behaviour, not to reproduce a
 * pre-fix defect. No source is reverted to manufacture a RED state.
 *
 * Order Pool / release seam and the FT2 provisioning ladder mirror the sibling
 * tests/integration/wms/release-readiness.test.ts exactly — same canonical
 * install → seedFreshInstall → FT2 confirm path, same real HTTP endpoints.
 */
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  systemQuery,
  withTenant,
  runWithTenantContext,
} from '@lasyncro/backend-core/db.js';
import { seedFreshInstall } from 'api-src/scripts/seed_fresh_install';
import { processDomainEvent } from 'api-src/events/processDomainEvent';
import { projectOrderAge } from 'api-src/projections/orderAgeProjection';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';
import { evaluateOrderConstraints } from 'api-src/services/constraints/constraintEngine';
import { issueTestToken } from '../../unit/helpers/auth';
import { encrypt } from 'api-src/security/encryption.service';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

/** Drains every unprocessed domain event for the shop, oldest first. */
async function pumpEvents(shopId: number, afterId = 0): Promise<number> {
  const rows = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId })
      .andWhere('id', '>', afterId)
      .orderBy('id', 'asc')
      .select('id')
  );
  for (const row of rows) {
    await runWithTenantContext(shopId, () => processDomainEvent(row.id));
  }
  return rows.length > 0 ? Number(rows[rows.length - 1].id) : afterId;
}

/** HMAC-signed Shopify install → returns the ghost owner + shopId. */
async function hmacInstall(shopDomain: string): Promise<{ shopId: number; userId: number }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params = { shop: shopDomain, timestamp };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k as keyof typeof params]}`)
    .join('&');
  const hmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  const install = await request(app)
    .get('/api/v1/integrations/shopify/install')
    .query({ ...params, hmac })
    .redirects(0);
  expect(install.status).toBe(302);

  const ghostEmail = `shopify-install+${shopDomain}@lasyncro.internal`;
  const lookup = await systemQuery(
    db.raw('SELECT public.resolve_auth_user_by_email(?) AS value', [ghostEmail])
  );
  const ghost = lookup.rows?.[0]?.value;
  expect(ghost).toBeTruthy();
  return { shopId: ghost.shop_id as number, userId: ghost.id as number };
}

/** Install → seed reviewer-shaped data → drive the lifecycle ladder to FT2. */
async function provisionFt2Shop(label: string): Promise<{ shopId: number; token: string }> {
  const shopDomain = `sla-decision-${label}-${Date.now()}.myshopify.com`;
  const { shopId, userId } = await hmacInstall(shopDomain);

  await seedFreshInstall(shopId);

  await withTenant(shopId, (trx) =>
    trx('integrations').insert({
      shop_id: shopId,
      platform: 'shopify',
      platform_shop_name: shopDomain,
      access_token_encrypted: encrypt('offline-test-token-no-network-call'),
      sync_status: 'COMPLETED',
      updated_at: new Date(),
    })
  );

  let cursor = 0;
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);
  cursor = await pumpEvents(shopId, cursor);

  const token = issueTestToken({ userId, shopId });
  const confirm = await request(app)
    .post('/api/v1/lifecycle/ft2/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(confirm.status).toBe(200);
  await pumpEvents(shopId);

  const atFt2 = await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').where({ shop_id: shopId }).first()
  );
  expect(atFt2?.phase).toBe('FT2');

  return { shopId, token };
}

function getPool(token: string) {
  return request(app).get('/api/v1/wms/order-pool').set('Authorization', `Bearer ${token}`);
}
function postRelease(token: string, body: Record<string, unknown>) {
  return request(app)
    .post('/api/v1/wms/batch/release')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/**
 * Appends a newer order_age_snapshot version carrying the requested breach
 * flag. order_age_snapshot is append-only/versioned and every consumer reads
 * DISTINCT ON (order) ORDER BY aggregate_version DESC, so the new highest
 * version is the one the pool and release query observe.
 *
 * The transaction-local projection guard is required: order_age_snapshot is
 * single-writer enforced (migration 0076,
 * enforce_projection_writer_order_age_snapshot). Same mechanism the sibling
 * release-readiness.test.ts / sla-approaching-semantics.test.ts fixtures use.
 */
async function setShippingSlaBreached(
  shopId: number,
  orderId: string,
  breached: boolean
): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const latest = await trx('order_age_snapshot')
      .where({ lasyncro_order_id: orderId })
      .orderBy('aggregate_version', 'desc')
      .first();

    await trx('order_age_snapshot').insert({
      lasyncro_order_id: orderId,
      aggregate_version: Number(latest?.aggregate_version ?? 0) + 1,
      age_since_creation_seconds: Number(latest?.age_since_creation_seconds ?? 0),
      age_since_paid_seconds: breached ? 60 * 60 * 96 : 60,
      age_since_fulfillment_seconds: null,
      is_shipping_sla_breached: breached,
      is_delivery_sla_breached: false,
      snapshot_generated_at: new Date(),
    });
  });
}

/** Reads the breach flag the pool/release ordering actually observes. */
async function latestBreachFlag(shopId: number, orderId: string): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('order_age_snapshot')
      .where({ lasyncro_order_id: orderId })
      .orderBy('aggregate_version', 'desc')
      .first('is_shipping_sla_breached')
  );
  return Boolean(row?.is_shipping_sla_breached);
}

/** Forces both comparison orders onto the same manual-priority footing. */
async function clearPriorityFlag(shopId: number, orderId: string): Promise<void> {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({ is_priority_flagged: false });
  });
}

async function setOrderCreatedAt(shopId: number, orderId: string, at: Date): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).update({ order_created_at: at })
  );
}

async function setOrderPaidAt(shopId: number, orderId: string, at: Date): Promise<void> {
  await withTenant(shopId, (trx) =>
    trx('orders').where({ lasyncro_order_id: orderId }).update({ paid_at: at })
  );
}

/** Runs the real constraint chain (engine → projection) for one order. */
async function runConstraintChain(shopId: number, orderId: string): Promise<
  Array<{ type: string; isActive: boolean; blockType: unknown }>
> {
  return withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const order = await trx('orders')
      .where({ lasyncro_order_id: orderId })
      .first('aggregate_version');
    const evaluations = await evaluateOrderConstraints(trx, orderId, shopId);
    await projectOrderConstraints(
      trx,
      orderId,
      shopId,
      Number(order!.aggregate_version),
      new Date(),
      evaluations
    );
    return evaluations.map((e) => ({
      type: e.type,
      isActive: e.isActive,
      blockType: e.meta?.blockType ?? null,
    }));
  });
}

async function activeConstraints(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId, is_active: true })
      .select('constraint_type', 'block_type')
  );
}

/** Whole-shop side-effect fingerprint for the zero-side-effect contracts. */
async function releaseSideEffectSnapshot(shopId: number) {
  return withTenant(shopId, async (trx) => ({
    batches: Number(
      (await trx('pick_batches').where({ shop_id: shopId }).count<{ count: string }>('* as count').first())?.count ?? 0
    ),
    batchOrders: Number(
      (await trx('pick_batch_orders').where({ shop_id: shopId }).count<{ count: string }>('* as count').first())?.count ?? 0
    ),
    holds: Number(
      (await trx('inventory_movements')
        .where({ shop_id: shopId, movement_type: 'reservation_hold' })
        .count<{ count: string }>('* as count')
        .first())?.count ?? 0
    ),
    fulfillmentStates: JSON.stringify(
      await trx('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .orderBy('ofs.lasyncro_order_id')
        .select('ofs.lasyncro_order_id', 'ofs.status', 'ofs.fulfilled_at')
    ),
  }));
}

async function poolIds(token: string): Promise<string[]> {
  const res = await getPool(token);
  expect(res.status).toBe(200);
  return res.body.orders.map((o: { lasyncro_order_id: string }) => o.lasyncro_order_id);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ORD-DECISION-01 — SLA breach is prioritisation, never a blocker or a release trigger', () => {
  describe('SLA-DEC-01 — SLA breach never creates an operational constraint', () => {
    it('leaves a breached order constraint-free and still in the normal Order Pool', async () => {
      const { shopId, token } = await provisionFt2Shop('dec01');
      const [orderId] = await poolIds(token);
      expect(orderId).toBeTruthy();

      await setShippingSlaBreached(shopId, orderId, true);
      expect(await latestBreachFlag(shopId, orderId)).toBe(true);

      // Real engine + real projection — the only writers of order_constraints.
      const evaluations = await runConstraintChain(shopId, orderId);

      // No evaluator may claim an active operational block off the back of SLA.
      expect(
        evaluations.filter((e) => e.type === 'operational' && e.isActive)
      ).toEqual([]);
      expect(evaluations.filter((e) => e.blockType === 'sla_breach')).toEqual([]);

      // Nothing persisted either — no operational row, no sla_breach block type.
      const active = await activeConstraints(shopId, orderId);
      expect(active.filter((c) => c.constraint_type === 'operational')).toEqual([]);
      expect(active.filter((c) => c.block_type === 'sla_breach')).toEqual([]);
      expect(active).toEqual([]);

      // Product contract 3: an otherwise releasable breached order stays pooled.
      expect(await poolIds(token)).toContain(orderId);
    }, 120_000);
  });

  describe('SLA-DEC-02 — breached orders are prioritised inside the pool', () => {
    it('sorts a NEWER SLA-breached order ahead of an OLDER non-breached order', async () => {
      const { shopId, token } = await provisionFt2Shop('dec02');
      const ids = await poolIds(token);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      const [breachedId, calmId] = ids;

      // Equivalent on every other sort key: same manual priority footing, and
      // the breached order is deliberately the YOUNGER of the two so the
      // created_at ASC tiebreak would place it LAST if breach were ignored.
      await clearPriorityFlag(shopId, breachedId);
      await clearPriorityFlag(shopId, calmId);
      await setOrderCreatedAt(shopId, calmId, new Date(Date.now() - 30 * 24 * 3600_000));
      await setOrderCreatedAt(shopId, breachedId, new Date());

      // Align persisted evidence and canonical read-time SLA truth.
      await setOrderPaidAt(shopId, breachedId, new Date(Date.now() - 96 * 3600_000));
      await setOrderPaidAt(shopId, calmId, new Date(Date.now() - 1 * 3600_000));
      await setShippingSlaBreached(shopId, breachedId, true);
      await setShippingSlaBreached(shopId, calmId, false);
      expect(await latestBreachFlag(shopId, breachedId)).toBe(true);
      expect(await latestBreachFlag(shopId, calmId)).toBe(false);

      const after = await poolIds(token);
      expect(after).toContain(breachedId);
      expect(after).toContain(calmId);
      expect(after.indexOf(breachedId)).toBeLessThan(after.indexOf(calmId));
    }, 120_000);
  });

  describe('SLA-DEC-03 — SLA breach alone releases nothing', () => {
    it('produces no batch, membership, hold or fulfilment advance; explicit release still works', async () => {
      const { shopId, token } = await provisionFt2Shop('dec03');
      const [orderId] = await poolIds(token);

      const before = await releaseSideEffectSnapshot(shopId);
      expect(before.batches).toBe(0);

      await setShippingSlaBreached(shopId, orderId, true);
      await poolIds(token); // the pool read is the only thing SLA drives

      const after = await releaseSideEffectSnapshot(shopId);
      expect(after.batches).toBe(before.batches);
      expect(after.batchOrders).toBe(before.batchOrders);
      expect(after.holds).toBe(before.holds);
      expect(after.fulfillmentStates).toBe(before.fulfillmentStates);

      const membership = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ lasyncro_order_id: orderId }).first()
      );
      expect(membership).toBeUndefined();

      // Product contract 6: release is still the merchant's explicit action,
      // and it still succeeds for the same breached order.
      const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
      expect(res.status).toBe(201);
      expect(res.body.pick_batch_id).toBeTruthy();
      expect(res.body.order_count).toBe(1);

      const released = await withTenant(shopId, (trx) =>
        trx('pick_batch_orders').where({ lasyncro_order_id: orderId }).first('pick_batch_id')
      );
      expect(released?.pick_batch_id).toBe(res.body.pick_batch_id);
    }, 120_000);
  });

  describe('SLA-DEC-04 — a real blocker outranks SLA urgency', () => {
    it('keeps an evaluator-derived inventory block authoritative on a breached order', async () => {
      const { shopId, token } = await provisionFt2Shop('dec04');
      const [orderId] = await poolIds(token);

      await setShippingSlaBreached(shopId, orderId, true);
      expect(await latestBreachFlag(shopId, orderId)).toBe(true);

      // Genuine oversell: strip pickable availability for this order's variants
      // so evaluateInventoryConstraint derives the block from inventory_truth.
      await withTenant(shopId, async (trx) => {
        const variants = await trx('order_revenue_units')
          .where({ lasyncro_order_id: orderId })
          .distinct('lasyncro_variant_id')
          .pluck('lasyncro_variant_id');
        expect(variants.length).toBeGreaterThanOrEqual(1);
        await trx('inventory_truth')
          .where({ shop_id: shopId })
          .whereIn('lasyncro_variant_id', variants)
          .update({ available_quantity: 0 });
      });

      const evaluations = await runConstraintChain(shopId, orderId);
      expect(
        evaluations.some((e) => e.type === 'inventory' && e.isActive && e.blockType === 'oversell')
      ).toBe(true);

      const active = await activeConstraints(shopId, orderId);
      expect(active.some((c) => c.constraint_type === 'inventory')).toBe(true);
      expect(active.some((c) => c.constraint_type === 'operational')).toBe(false);

      // Blocker ownership survives the breach: out of the pool, and an explicit
      // release classifies it `blocked` without mutating anything.
      expect(await poolIds(token)).not.toContain(orderId);

      const before = await releaseSideEffectSnapshot(shopId);
      const res = await postRelease(token, { priority_order_ids: [orderId], exclusive: true });
      const after = await releaseSideEffectSnapshot(shopId);

      expect(res.status).toBe(201);
      expect(res.body.order_count).toBe(0);
      expect(res.body.pick_batch_id).toBeNull();
      expect(res.body.skipped_orders).toEqual(
        expect.arrayContaining([expect.objectContaining({ order_id: orderId, reason: 'blocked' })])
      );

      expect(after.batches).toBe(before.batches);
      expect(after.batchOrders).toBe(before.batchOrders);
      expect(after.holds).toBe(before.holds);
      expect(after.fulfillmentStates).toBe(before.fulfillmentStates);
    }, 120_000);
  });

  describe('SLA-DEC-05 — fulfilled orders leave the active Fulfillment-SLA population', () => {
    it('projects is_shipping_sla_breached=false once the order is fulfilled, at the same paid age', async () => {
      const { shopId, token } = await provisionFt2Shop('dec05');
      const [orderId] = await poolIds(token);

      // Same paid age throughout — only fulfilment changes between the two runs.
      const longAgo = new Date(Date.now() - 30 * 24 * 3600_000);
      await withTenant(shopId, (trx) =>
        trx('orders')
          .where({ lasyncro_order_id: orderId })
          .update({ order_created_at: longAgo, paid_at: longAgo })
      );

      const project = async (version: number) =>
        withTenant(shopId, async (trx) => {
          await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
          await projectOrderAge(trx, orderId, String(shopId), version, new Date());
          return trx('order_age_snapshot')
            .where({ lasyncro_order_id: orderId, aggregate_version: version })
            .first('is_shipping_sla_breached');
        });

      const latest = await withTenant(shopId, (trx) =>
        trx('order_age_snapshot')
          .where({ lasyncro_order_id: orderId })
          .orderBy('aggregate_version', 'desc')
          .first('aggregate_version')
      );
      const base = Number(latest?.aggregate_version ?? 0);

      // Control: unfulfilled at 30 days paid age IS breached.
      const unfulfilled = await project(base + 1);
      expect(Boolean(unfulfilled?.is_shipping_sla_breached)).toBe(true);

      await withTenant(shopId, async (trx) => {
        await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
        await trx('order_fulfillment_status')
          .where({ lasyncro_order_id: orderId })
          .update({ status: 'fulfilled', fulfilled_at: new Date() });
      });

      // Contract: the identical paid age is no longer an active breach.
      const fulfilled = await project(base + 2);
      expect(Boolean(fulfilled?.is_shipping_sla_breached)).toBe(false);

      // And a fulfilled order is no longer pool-releasable either.
      expect(await poolIds(token)).not.toContain(orderId);
    }, 120_000);
  });
});
