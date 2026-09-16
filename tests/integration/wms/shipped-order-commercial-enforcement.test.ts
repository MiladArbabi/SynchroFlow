// tests/integration/wms/shipped-order-commercial-enforcement.test.ts
//
// MON-ALLOW-04 — regression contract for shipped-order commercial
// enforcement at WMS pack-complete.
//
// Endpoint under test: POST /api/v1/wms/batch/:batchId/pack-complete
// (httpCompletePack, apps/backend/src/api/wms/wms.controller.ts). This is
// the ONLY place shipped-order allowance/cap/overage decisions are made —
// POST /batch/:batchId/ship (confirmShipment.service.ts) performs physical
// status transitions only and contains no commercial logic.
//
// Every assertion here traces to a specific source line proven during the
// read-only preflight for this slice:
//   - Tier for the cap decision is read live from shop_subscriptions.tier
//     inside the transaction, never the JWT (wms.controller.ts:1559-1568).
//   - Canonical shippedOrderCap: starter=0, core=2000, growth=7500,
//     scale=20000 (via @lasyncro/commercial-policy compatibility exports).
//   - Reaching the cap exactly is never billable: overageUnits is only
//     > 0 strictly beyond shippedOrderCap (wms.controller.ts:1622-1630).
//   - A rejection throws before any mutation in the same transaction
//     (pick_batches update, usage increment, domain_events insert, alert)
//     so the whole transaction rolls back (wms.controller.ts:1596-1787).
//   - domain_event_outbox gets exactly one row per domain_event via the
//     DB trigger (migration 0062), never written directly by the handler.
//   - The dispatcher worker (apps/backend/src/workers/domain-event-outbox
//     .dispatcher.ts) is what calls Stripe/Shopify — it is a separate
//     poll-loop process never started by createApp() or this test.
//
// Real Express app (createApp(), never server.ts/api-server) + real
// disposable PostgreSQL + issueTestToken for auth. No global/full_identity
// seed. No worker started. No Stripe/Shopify call anywhere in this file or
// the code path it exercises.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const mockDispatchNotification = jest.fn().mockResolvedValue(undefined);
jest.mock('api-src/services/notifications/notificationDispatch.service', () => ({
  dispatchNotification: (...args: unknown[]) => mockDispatchNotification(...args),
}));

const app = createApp();

type FixtureTier = 'starter' | 'core' | 'growth' | 'scale';

type FixtureInput = {
  tier: FixtureTier;
  usageBefore: number;
  allowOverage?: boolean;
  billingProvider?: 'stripe' | 'shopify';
  stripeCustomerId?: string;
  physicalEvidence?: 'complete' | 'missing' | 'no-orders' | 'no-lines' | 'no-status' | 'packing' | 'no-scan' | 'short-scan';
};

type Fixture = {
  shopId: number;
  userId: number;
  batchId: string;
  usagePeriodId: number;
};

/**
 * Minimum deterministic fixture graph proven required by httpCompletePack:
 * shop, owner user + membership, FT2 lifecycle snapshot, explicit
 * shop_subscriptions row, one compatible OPEN shop_usage_metrics period,
 * one order + non-cancelled order_fulfillment_status row, one pick_batches
 * row in 'packing' status owned by the fixture user, and the
 * pick_batch_orders link between them. Commercial cases also contain a
 * product/variant, a real order line, a confirmed pack scan and packed order
 * warehouse status. Physical guard cases explicitly omit/invalidate evidence.
 * No external provider or notification delivery is exercised.
 */
async function createCommercialFixture(
  namePrefix: string,
  input: FixtureInput
): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${namePrefix}+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    })
  );

  // requireFt2 defaults to FT_MINUS_ONE (403) absent a snapshot row.
  await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    })
  );

  // Explicit subscription row: the cap decision reads shop_subscriptions
  // live, defaulting to tier='starter' if absent — pinning it here makes
  // the tier under test unambiguous rather than relying on that default.
  await withTenant(shopId, (trx) =>
    trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: input.tier,
      allow_overage: input.allowOverage ?? true,
      billing_provider: input.billingProvider ?? 'stripe',
      stripe_customer_id: input.stripeCustomerId ?? null,
    })
  );

  // getOrRotateOpenUsagePeriod only reuses an existing open Starter period
  // if period_starts_at falls within the current UTC calendar month;
  // Core/Growth periods are reused regardless of period_starts_at. Anchor
  // to the current UTC month start so Starter fixtures are never rotated
  // out from under the seeded usageBefore value.
  const now = new Date();
  const currentUtcMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const periodStartsAt = input.tier === 'starter' ? currentUtcMonthStart : now;

  const usagePeriodId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('shop_usage_metrics')
      .insert({
        shop_id: shopId,
        period_starts_at: periodStartsAt,
        period_ends_at: null,
        tier_at_period_start: input.tier,
        shipped_orders: input.usageBefore,
      })
      .returning('id');
    return row.id as number;
  });

  const lasyncroOrderId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: '0.00',
      subtotal_price: '0.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    })
  );

  // Default status is 'pending' — must participate in the handler's
  // billable-order JOIN and must not be 'cancelled'. order_fulfillment_status
  // is projection-single-writer guarded (migration 0076): direct writes
  // outside SET LOCAL synchroflow.projection = 'true' raise
  // PROJECTION_WRITE_VIOLATION.
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'pending',
    });
  });

  const batchId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('pick_batches').insert({
      pick_batch_id: batchId,
      shop_id: shopId,
      status: 'packing',
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
      packed_by: userId,
      released_at: now,
    })
  );

  await withTenant(shopId, (trx) =>
    trx('pick_batch_orders').insert({
      pick_batch_id: batchId,
      lasyncro_order_id: lasyncroOrderId,
      shop_id: shopId,
    })
  );

  const evidence = input.physicalEvidence ?? 'complete';
  await withTenant(shopId, async (trx) => {
    if (evidence === 'no-orders') {
      await trx('pick_batch_orders').where({ pick_batch_id: batchId }).delete();
      return;
    }
    if (evidence === 'missing') return;
    if (evidence !== 'no-status') {
      await trx('order_warehouse_status').insert({
        lasyncro_order_id: lasyncroOrderId, pick_batch_id: batchId,
        status: evidence === 'packing' ? 'packing' : 'packed',
        packed_at: evidence === 'packing' ? null : now,
      });
    }
    if (evidence === 'no-lines') return;
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId, title: 'Packed fixture product' });
    await trx('variants').insert({
      lasyncro_variant_id: variantId, lasyncro_product_id: productId, shop_id: shopId,
      sku: `PACK-${unique}`, title: 'Packed fixture variant', status: 'active', unit_cost: '1.00',
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineId, lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: productId, lasyncro_variant_id: variantId, title: 'Packed fixture line',
      quantity: 2, unit_price: '5.00', line_total: '10.00', created_at: now, updated_at: now,
    });
    await trx('order_line_item_warehouse_status').insert({
      lasyncro_line_item_id: lineId, lasyncro_order_id: lasyncroOrderId, shop_id: shopId,
      status: evidence === 'no-scan' || evidence === 'short-scan' ? 'packing' : 'packed',
    });
    if (evidence !== 'no-scan') {
      await trx('pack_scan_log').insert({
        scan_id: crypto.randomUUID(), shop_id: shopId, pick_batch_id: batchId,
        lasyncro_order_id: lasyncroOrderId, lasyncro_line_item_id: lineId, lasyncro_variant_id: variantId,
        quantity_confirmed: evidence === 'short-scan' ? 1 : 2, status: 'confirmed',
        scanned_by: userId, scanned_at: now,
      });
    }
    await trx('pick_batches').where({ pick_batch_id: batchId }).update({ total_units: 2, units_packed: evidence === 'no-scan' ? 0 : evidence === 'short-scan' ? 1 : 2 });
  });

  return { shopId, userId, batchId, usagePeriodId };
}

async function readShippedOrders(shopId: number, usagePeriodId: number): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_usage_metrics')
      .where({ id: usagePeriodId, shop_id: shopId })
      .first('shipped_orders')
  );
  return Number(row?.shipped_orders);
}

async function readBatchState(
  shopId: number,
  batchId: string
): Promise<{ status: string; pack_completed_at: Date | null }> {
  const row = await withTenant(shopId, (trx) =>
    trx('pick_batches')
      .where({ pick_batch_id: batchId, shop_id: shopId })
      .first('status', 'pack_completed_at')
  );
  return row;
}

async function countBillingOverageEvents(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'billing/overage' })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

/** domain_event_outbox has no shop_id column — scope through domain_events. */
async function countBillingOverageOutboxRows(shopId: number): Promise<number> {
  const [{ count }] = await withTenant(shopId, (trx) =>
    trx('domain_event_outbox as o')
      .join('domain_events as e', 'e.id', 'o.domain_event_id')
      .where({ 'e.shop_id': shopId, 'e.event_type': 'billing/overage' })
      .count<{ count: string }[]>('* as count')
  );
  return Number(count);
}

async function getBillingOverageEventPayload(shopId: number): Promise<Record<string, unknown>> {
  const row = await withTenant(shopId, (trx) =>
    trx('domain_events')
      .where({ shop_id: shopId, event_type: 'billing/overage' })
      .first('event_payload')
  );
  return row.event_payload as Record<string, unknown>;
}

async function packComplete(shopId: number, userId: number, batchId: string) {
  const subscription = await withTenant(shopId, (trx) =>
    trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .first('tier')
  );

  const tier = subscription?.tier as FixtureTier | undefined;
  if (!tier) {
    throw new Error('TEST_FIXTURE_SUBSCRIPTION_TIER_MISSING');
  }

  const token = issueTestToken({ userId, shopId, tier });

  return request(app)
    .post(`/api/v1/wms/batch/${batchId}/pack-complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
}

describe('Shipped-order commercial enforcement (MON-REM-01B-2)', () => {
  // Paid-tier commercial invariant:
  //
  // Included allowance affects billing economics, never warehouse execution.
  // Core, Growth, and Scale continue pack-complete above allowance regardless
  // of the legacy allow_overage preference. Crossing into overage persists one
  // durable billing/overage event + outbox row in the same transaction.

  describe('COMMERCIAL-01: Core included boundary remains non-billable', () => {
    it('1999 -> 2000 succeeds under allow_overage=false with no overage event', async () => {
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com01', {
          tier: 'core',
          usageBefore: 1999,
          allowOverage: false,
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(2000);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(0);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(0);
    });
  });

  describe('COMMERCIAL-02: Core overage cannot be disabled by legacy preference', () => {
    it('2000 -> 2001 succeeds under allow_overage=false and persists one billing intent', async () => {
      const stripeCustomerId = 'cus_test_fixture_core_overage';
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com02', {
          tier: 'core',
          usageBefore: 2000,
          allowOverage: false,
          billingProvider: 'stripe',
          stripeCustomerId,
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(2001);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('stripe');
      expect(payload.overage_units).toBe(1);
      expect(payload.stripe_customer_id).toBe(stripeCustomerId);
    });
  });

  describe('COMMERCIAL-03: Growth overage cannot be disabled by legacy preference', () => {
    it('7500 -> 7501 succeeds under allow_overage=false and persists one billing intent', async () => {
      const stripeCustomerId = 'cus_test_fixture_growth_overage';
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com03', {
          tier: 'growth',
          usageBefore: 7500,
          allowOverage: false,
          billingProvider: 'stripe',
          stripeCustomerId,
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(7501);

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('stripe');
      expect(payload.overage_units).toBe(1);
    });
  });

  describe('COMMERCIAL-04: Scale has finite billable overage', () => {
    it('20000 -> 20001 succeeds and persists one billing intent', async () => {
      const stripeCustomerId = 'cus_test_fixture_scale_overage';
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com04', {
          tier: 'scale',
          usageBefore: 20000,
          allowOverage: false,
          billingProvider: 'stripe',
          stripeCustomerId,
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(20001);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('stripe');
      expect(payload.overage_units).toBe(1);
      expect(payload.stripe_customer_id).toBe(stripeCustomerId);
    });
  });

  describe('COMMERCIAL-05: missing Stripe customer never blocks fulfillment', () => {
    it('persists the overage intent for asynchronous delivery failure/retry', async () => {
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com05', {
          tier: 'core',
          usageBefore: 2000,
          allowOverage: false,
          billingProvider: 'stripe',
          stripeCustomerId: undefined,
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(2001);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('stripe');
      expect(payload.overage_units).toBe(1);
      expect(payload).not.toHaveProperty('stripe_customer_id');
    });
  });

  describe('COMMERCIAL-06: missing Shopify GID never blocks fulfillment', () => {
    it('persists the overage intent for asynchronous delivery failure/retry', async () => {
      const { shopId, userId, batchId, usagePeriodId } =
        await createCommercialFixture('com06', {
          tier: 'growth',
          usageBefore: 7500,
          allowOverage: false,
          billingProvider: 'shopify',
        });

      const res = await packComplete(shopId, userId, batchId);

      expect(res.status).toBe(200);
      expect(await readShippedOrders(shopId, usagePeriodId)).toBe(7501);

      const batch = await readBatchState(shopId, batchId);
      expect(batch.status).toBe('pack_complete');
      expect(batch.pack_completed_at).not.toBeNull();

      expect(await countBillingOverageEvents(shopId)).toBe(1);
      expect(await countBillingOverageOutboxRows(shopId)).toBe(1);

      const payload = await getBillingOverageEventPayload(shopId);
      expect(payload.billing_provider).toBe('shopify');
      expect(payload.overage_units).toBe(1);
      expect(payload).not.toHaveProperty('shop_gid');
    });
  });
});


describe('PACK-COMPLETE-GUARD-01', () => {
  async function rejectsWithoutEffects(physicalEvidence: FixtureInput['physicalEvidence']) {
    // Core is seeded exactly at its current included allowance, so a
    // physically valid completion would create one billable overage unit.
    const fixture = await createCommercialFixture('physical-guard', {
      tier: 'core', usageBefore: 2000, allowOverage: true,
      stripeCustomerId: 'cus_pack_guard_synthetic', physicalEvidence,
    });
    const { shopId, userId, batchId, usagePeriodId } = fixture;
    const snapshot = async () => ({
      batch: await readBatchState(shopId, batchId),
      usage: await readShippedOrders(shopId, usagePeriodId),
      events: await countBillingOverageEvents(shopId),
      outbox: await countBillingOverageOutboxRows(shopId),
      alerts: await withTenant(shopId, (trx) => trx('alerts')
        .where({ shop_id: shopId, alert_key: `wms:batch:ready_to_ship:${batchId}` }).select('id')),
    });
    const before = await snapshot();
    expect(before).toEqual({ batch: { status: 'packing', pack_completed_at: null }, usage: 2000, events: 0, outbox: 0, alerts: [] });
    mockDispatchNotification.mockClear();
    const response = await packComplete(shopId, userId, batchId);
    const after = await snapshot();
    expect({ status: response.status, error: response.body.error, state: after,
      notificationCalls: mockDispatchNotification.mock.calls.length }).toEqual({
      status: 409, error: 'BATCH_PACKING_INCOMPLETE', state: before, notificationCalls: 0,
    });
  }

  it('rejects absent physical evidence without commercial or ready-to-ship effects', async () => {
    await rejectsWithoutEffects('missing');
  });
  it('rejects a batch with zero member orders', async () => {
    await rejectsWithoutEffects('no-orders');
  });
  it('rejects a packed order with zero line items', async () => {
    await rejectsWithoutEffects('no-lines');
  });
  it('rejects missing order warehouse status even with confirmed scans', async () => {
    await rejectsWithoutEffects('no-status');
  });
  it('rejects an order still packing even with confirmed scans', async () => {
    await rejectsWithoutEffects('packing');
  });
  it('rejects a packed order with no confirmed scan for its line', async () => {
    await rejectsWithoutEffects('no-scan');
  });
  it('rejects confirmed scan quantity below the line quantity', async () => {
    await rejectsWithoutEffects('short-scan');
  });
});
